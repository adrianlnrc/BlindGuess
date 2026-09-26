/**
 * Teste de contrato da descoberta de pais (`paisDe`).
 *
 * A sequencia de paises vive desta funcao: e ela que decide se a partida
 * continua ou acaba. Como ela fala com a Geocoding API, que nunca roda aqui,
 * trocamos `globalThis.fetch` por respostas fieis ao contrato da API — e
 * checamos tanto o que volta quanto o que vai na requisicao.
 *
 * O que mais importa aqui e a diferenca entre "nao ha pais neste ponto" e "a
 * consulta falhou": tratar falha nossa como erro do jogador acabaria com a
 * sequencia dele por nada.
 *
 * Rodar com:  npx tsx scripts/teste-paises.ts
 */

// A chave e lida dentro de `paisDe`; precisa existir antes da primeira chamada.
process.env.GOOGLE_MAPS_API_KEY = "CHAVE-DE-TESTE";
delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

// ---------------------------------------------------------------- fetch falso

type FakeHandler = (url: URL) => Promise<Response>;

let handler: FakeHandler = async () => geocode({ status: "ZERO_RESULTS" });
let requests: URL[] = [];

globalThis.fetch = (async (input: unknown) => {
  const url =
    input instanceof URL ? new URL(input.toString()) : new URL(String((input as Request)?.url ?? input));
  requests.push(url);
  return handler(url);
}) as typeof fetch;

function geocode(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Resposta OK com um pais, no formato que a Geocoding API devolve. */
function comPais(longName: string, shortName: string): Response {
  return geocode({
    status: "OK",
    results: [
      {
        address_components: [{ long_name: longName, short_name: shortName, types: ["country", "political"] }],
      },
    ],
  });
}

function setHandler(fn: FakeHandler): void {
  handler = fn;
  requests = [];
}

/** Troca a resposta sem zerar o historico: os casos de cache contam consultas. */
function trocaResposta(fn: FakeHandler): void {
  handler = fn;
}

// `paisDe` so pode ser importado depois que o fetch foi substituido.
const { paisDe, limpaCacheDePaises } = await import("../src/server/paises.ts");

// -------------------------------------------------------------- verificacoes

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

async function capturaErro(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err as Error;
  }
}

const LISBOA = { lat: 38.7223, lng: -9.1393 };
const MADRI = { lat: 40.4168, lng: -3.7038 };
const MEIO_DO_ATLANTICO = { lat: 30.0, lng: -40.0 };

console.log("\n[1] o pais vem do codigo ISO, nao do nome");
limpaCacheDePaises();
setHandler(async () => comPais("Portugal", "pt"));
let pais = await paisDe(LISBOA);
ok("devolve codigo e nome", pais?.code === "PT" && pais?.name === "Portugal", `${pais?.code} · ${pais?.name}`);
ok("o codigo vem em maiusculas mesmo quando a API responde minusculo", pais?.code === "PT", `short_name "pt" → ${pais?.code}`);

console.log("\n[2] a requisicao pede o que precisamos");
const url = requests[0];
ok("pede so o componente de pais", url.searchParams.get("result_type") === "country", `result_type=${url.searchParams.get("result_type")}`);
ok("pede o nome em portugues", url.searchParams.get("language") === "pt-BR", `language=${url.searchParams.get("language")}`);
ok("manda o ponto certo", url.searchParams.get("latlng") === `${LISBOA.lat},${LISBOA.lng}`, `latlng=${url.searchParams.get("latlng")}`);
ok("leva a chave", url.searchParams.get("key") === "CHAVE-DE-TESTE", "key presente");

console.log("\n[3] o cache por celula evita uma conta de API por clique");
limpaCacheDePaises();
setHandler(async () => comPais("Portugal", "PT"));
await paisDe(LISBOA);
const depoisDoPrimeiro = requests.length;
// Mesma celula de 0,1 grau: ~2 km ao lado.
await paisDe({ lat: LISBOA.lat + 0.01, lng: LISBOA.lng + 0.01 });
ok("dois cliques na mesma celula fazem uma consulta so", requests.length === depoisDoPrimeiro, `${requests.length} consulta(s) para 2 cliques`);

// Celula diferente: tem que consultar de novo, senao o cache estaria grosso
// demais e Portugal responderia por Espanha.
trocaResposta(async () => comPais("Espanha", "ES"));
const espanha = await paisDe(MADRI);
ok("outra celula consulta de novo", requests.length > depoisDoPrimeiro, `${requests.length} consultas no total`);
ok("e devolve o pais certo", espanha?.code === "ES", `${espanha?.code} · ${espanha?.name}`);

console.log("\n[4] mar e falha sao coisas diferentes");
limpaCacheDePaises();
setHandler(async () => geocode({ status: "ZERO_RESULTS" }));
const mar = await paisDe(MEIO_DO_ATLANTICO);
ok("ponto no mar devolve null (nao lanca)", mar === null, "ZERO_RESULTS → null");

const antesDoCache = requests.length;
await paisDe(MEIO_DO_ATLANTICO);
ok("o null tambem fica no cache", requests.length === antesDoCache, `${requests.length} consulta(s) para 2 cliques no mar`);

limpaCacheDePaises();
setHandler(async () => geocode({ status: "OVER_QUERY_LIMIT" }));
let erro = await capturaErro(() => paisDe(LISBOA));
ok("cota estourada lanca em vez de virar 'sem pais'", erro !== null, `${erro?.message}`);

limpaCacheDePaises();
setHandler(async () => geocode({ status: "REQUEST_DENIED" }));
erro = await capturaErro(() => paisDe(LISBOA));
ok("chave recusada lanca", erro !== null, `${erro?.message}`);

limpaCacheDePaises();
setHandler(async () => geocode({ error: "boom" }, 500));
erro = await capturaErro(() => paisDe(LISBOA));
ok("HTTP 500 lanca", erro !== null, `${erro?.message}`);

console.log("\n[5] falha nao envenena o cache");
limpaCacheDePaises();
setHandler(async () => geocode({ status: "OVER_QUERY_LIMIT" }));
await capturaErro(() => paisDe(LISBOA));
// A cota volta ao normal: a mesma celula tem que consultar de novo, senao o
// jogador ficaria com "sem pais" em Lisboa pelo resto do processo.
trocaResposta(async () => comPais("Portugal", "PT"));
pais = await paisDe(LISBOA);
ok("depois da falha a mesma celula consulta de novo", pais?.code === "PT", `${pais?.code}`);

console.log("\n[6] sem chave nao finge que deu certo");
limpaCacheDePaises();
const guardada = process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
erro = await capturaErro(() => paisDe(LISBOA));
ok("sem chave lanca em vez de devolver null", erro !== null, `${erro?.message}`);
process.env.GOOGLE_MAPS_API_KEY = guardada;

console.log("\n[7] a celula nao cruza o equador nem o meridiano por engano");
limpaCacheDePaises();
setHandler(async () => comPais("Gabão", "GA"));
await paisDe({ lat: 0.05, lng: 9.45 });
const antesDoNegativo = requests.length;
// Latitude negativa do outro lado do equador: celula diferente, consulta nova.
await paisDe({ lat: -0.05, lng: 9.45 });
ok("lados opostos do equador sao celulas diferentes", requests.length > antesDoNegativo, `${requests.length} consultas`);

const total = 2 + 4 + 3 + 6 + 1 + 1 + 1;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);

export {};
