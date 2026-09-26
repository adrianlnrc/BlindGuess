import type { LatLng } from "@/lib/types";

/**
 * Descobre em que pais um ponto caiu. E o que a sequencia de paises precisa
 * saber: o jogo compara o pais do alvo com o pais de onde o jogador clicou.
 *
 * Mora fora de `locations.ts` de proposito — aquele arquivo procura panorama,
 * este responde uma pergunta de geografia, e os dois falam com APIs diferentes.
 */

export type Pais = {
  /** ISO-3166-1 alfa-2. E por ele que se compara, nunca pelo nome. */
  code: string;
  /** Nome em portugues, que e o que aparece na tela. */
  name: string;
};

/**
 * Lado da celula do cache, em graus (~11 km). O alvo e consultado toda rodada e
 * os palpites caem repetidamente nos mesmos lugares (capitais, pontos famosos);
 * sem cache isto vira uma conta de API por clique. Uma celula deste tamanho
 * quase nunca cruza fronteira, e quando cruza o erro e de poucos quilometros —
 * bem dentro da margem de quem esta apontando um pais num mapa-mundi.
 */
const CELULA_GRAUS = 0.1;

/**
 * Ponto no mar, deserto sem divisao administrativa, Antartida: o geocodificador
 * responde ZERO_RESULTS. Isso e um nao legitimo e tambem fica no cache, senao
 * todo clique no oceano vira uma consulta nova.
 */
const SEM_PAIS = null;

const cache = new Map<string, Pais | null>();

function chaveDaCelula(ponto: LatLng): string {
  const lat = Math.floor(ponto.lat / CELULA_GRAUS);
  const lng = Math.floor(ponto.lng / CELULA_GRAUS);
  return `${lat}:${lng}`;
}

type GeocodeResponse = {
  status: string;
  results?: {
    address_components?: { long_name: string; short_name: string; types: string[] }[];
  }[];
};

/**
 * So o componente de pais interessa. Pedimos `result_type=country` para a API
 * ja filtrar, mas a resposta ainda pode trazer outros componentes junto.
 */
function extraiPais(data: GeocodeResponse): Pais | null {
  for (const resultado of data.results ?? []) {
    for (const parte of resultado.address_components ?? []) {
      if (parte.types?.includes("country") && parte.short_name) {
        return { code: parte.short_name.toUpperCase(), name: parte.long_name };
      }
    }
  }
  return SEM_PAIS;
}

async function consulta(ponto: LatLng, apiKey: string): Promise<Pais | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${ponto.lat},${ponto.lng}`);
  url.searchParams.set("result_type", "country");
  // O nome vai para a tela; o codigo e que serve para comparar.
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geocode respondeu ${res.status}`);

  const data = (await res.json()) as GeocodeResponse;
  if (data.status === "ZERO_RESULTS") return SEM_PAIS;
  // OVER_QUERY_LIMIT, REQUEST_DENIED e afins nao sao "nao ha pais": sao falha
  // nossa, e cair no cache como `null` estragaria os proximos palpites.
  if (data.status !== "OK") throw new Error(`geocode: ${data.status}`);

  return extraiPais(data);
}

/**
 * Em que pais este ponto cai? `null` quando nao ha pais ali (mar, Antartida).
 *
 * Lanca quando a consulta falhou — quem chama precisa distinguir "caiu no mar"
 * de "a API esta fora do ar": num jogo de sequencia, tratar falha nossa como
 * erro do jogador acabaria com a partida dele por nada.
 */
export async function paisDe(ponto: LatLng): Promise<Pais | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY não configurada");

  const chave = chaveDaCelula(ponto);
  if (cache.has(chave)) return cache.get(chave) ?? SEM_PAIS;

  const pais = await consulta(ponto, apiKey);
  cache.set(chave, pais);
  return pais;
}

/** Só para os testes: o cache é global e vazaria de um caso para o outro. */
export function limpaCacheDePaises(): void {
  cache.clear();
}
