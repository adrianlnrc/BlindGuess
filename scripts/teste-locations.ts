/**
 * Teste de contrato do sorteio de local (`pickLocation`).
 *
 * `pickLocation` e o unico caminho do sistema que nunca rodou de verdade: sem
 * chave do Google ele devolve `null` antes mesmo de montar a URL. Aqui trocamos
 * `globalThis.fetch` por respostas fieis ao contrato da Street View Metadata API
 * e checamos tanto o que volta quanto o que vai na requisicao.
 *
 * Rodar com:  npx tsx scripts/teste-locations.ts
 */

// A chave e lida dentro de pickLocation; precisa existir antes da primeira chamada.
process.env.GOOGLE_MAPS_API_KEY = "CHAVE-DE-TESTE";
delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

import type { RegionId } from "../src/lib/types.ts";

// ---------------------------------------------------------------- fetch falso

type FakeHandler = (url: URL, init: RequestInit | undefined) => Promise<Response>;

let handler: FakeHandler = async () => metadata({ status: "ZERO_RESULTS" });
let requests: { url: URL; init: RequestInit | undefined }[] = [];

globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url =
    input instanceof URL ? new URL(input.toString()) : new URL(String((input as Request)?.url ?? input));
  requests.push({ url, init });
  return handler(url, init);
}) as typeof fetch;

/** Resposta 200 com corpo JSON, como a Metadata API devolve (inclusive nos erros). */
function metadata(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Configura o fetch falso para esta caso de teste e zera o historico. */
function setHandler(fn: FakeHandler): void {
  handler = fn;
  requests = [];
}

// `pickLocation` so pode ser importado depois que o fetch foi substituido.
const { pickLocation } = await import("../src/server/locations.ts");

// ------------------------------------------------------- controle do Math.random

const realRandom = Math.random;

/**
 * Cada tentativa de `pickLocation` consome 3 sorteios, nesta ordem:
 * indice da semente, desvio da latitude, desvio da longitude.
 * A funcao recebe o indice da chamada (0,1,2, 0,1,2, ...) e devolve o valor.
 */
function stubRandom(fn: (callIndex: number, slot: 0 | 1 | 2) => number): void {
  let i = 0;
  Math.random = () => {
    const value = fn(i, (i % 3) as 0 | 1 | 2);
    i += 1;
    return value;
  };
}

function restoreRandom(): void {
  Math.random = realRandom;
}

// ------------------------------------------------------------------- asserts

let falhas = 0;
let atual = "";
const problemas: string[] = [];

function check(condicao: boolean, descricao: string): void {
  if (!condicao) problemas.push(descricao);
}

function eq(recebido: unknown, esperado: unknown, descricao: string): void {
  const ok = Object.is(recebido, esperado);
  if (!ok) problemas.push(`${descricao} (recebido: ${JSON.stringify(recebido)}, esperado: ${JSON.stringify(esperado)})`);
}

async function caso(nome: string, fn: () => Promise<void>): Promise<void> {
  atual = nome;
  problemas.length = 0;
  try {
    await fn();
  } catch (erro) {
    problemas.push(`exceção inesperada: ${erro instanceof Error ? erro.stack ?? erro.message : String(erro)}`);
  } finally {
    restoreRandom();
  }
  if (problemas.length === 0) {
    console.log(`OK    ${atual}`);
  } else {
    falhas += 1;
    console.log(`FALHA ${atual}`);
    for (const p of problemas) console.log(`        - ${p}`);
  }
}

// --------------------------------------------------------------------- casos

/** 1. status OK: o panorama devolvido e o da RESPOSTA, nao o ponto pedido. */
await caso(
  "1. status OK devolve panoId/lat/lng da resposta, nao a coordenada pedida",
  async () => {
    const respostaDoGoogle = {
      status: "OK",
      copyright: "© Google",
      date: "2023-05",
      pano_id: "PANO_DA_RESPOSTA_1",
      // De proposito bem longe do ponto pedido: o Google devolve o panorama
      // mais proximo, que quase nunca cai exatamente na coordenada pedida.
      location: { lat: -23.42109, lng: -46.71005 },
    };
    setHandler(async () => metadata(respostaDoGoogle));

    const found = await pickLocation("brazil", 1);
    check(found !== null, "deveria devolver um local");
    if (!found) return;

    eq(found.panoId, "PANO_DA_RESPOSTA_1", "panoId deve vir da resposta");
    eq(found.lat, -23.42109, "lat deve vir de location.lat da resposta");
    eq(found.lng, -46.71005, "lng deve vir de location.lng da resposta");

    // E o ponto pedido era outro — prova de que nao esta ecoando o pedido.
    eq(requests.length, 1, "deveria ter feito exatamente 1 requisição");
    const pedido = requests[0].url.searchParams.get("location")!;
    const [latPedida, lngPedida] = pedido.split(",").map(Number);
    check(
      latPedida !== found.lat || lngPedida !== found.lng,
      `o ponto pedido (${pedido}) não pode ser igual ao devolvido — seria pontuação errada silenciosa`,
    );
  },
);

/** 2. ZERO_RESULTS nao pode desistir: tem que tentar a proxima semente. */
await caso("2. ZERO_RESULTS tenta a próxima semente em vez de desistir", async () => {
  let n = 0;
  setHandler(async () => {
    n += 1;
    if (n < 3) return metadata({ status: "ZERO_RESULTS" });
    return metadata({ status: "OK", pano_id: "PANO_NA_TERCEIRA", location: { lat: 10, lng: 20 } });
  });

  const found = await pickLocation("europe", 12);
  eq(found?.panoId, "PANO_NA_TERCEIRA", "deveria achar na terceira tentativa");
  eq(requests.length, 3, "deveria ter feito 3 requisições (2 vazias + 1 boa)");
});

/** 3. REQUEST_DENIED e OVER_QUERY_LIMIT: tratados, sem estourar excecao. */
await caso("3. REQUEST_DENIED e OVER_QUERY_LIMIT são tratados sem exceção", async () => {
  setHandler(async () =>
    metadata({ status: "REQUEST_DENIED", error_message: "This API project is not authorized..." }),
  );
  const negado = await pickLocation("world", 4);
  eq(negado, null, "REQUEST_DENIED deve resultar em null");
  eq(requests.length, 4, "REQUEST_DENIED deve consumir as 4 tentativas");

  setHandler(async () => metadata({ status: "OVER_QUERY_LIMIT" }));
  const cota = await pickLocation("world", 3);
  eq(cota, null, "OVER_QUERY_LIMIT deve resultar em null");
  eq(requests.length, 3, "OVER_QUERY_LIMIT deve consumir as 3 tentativas");
});

/** 4. HTTP nao-2xx (500) nao pode quebrar. */
await caso("4. HTTP 500 não quebra e conta como tentativa falha", async () => {
  setHandler(async () => new Response("Internal Server Error", { status: 500 }));
  const found = await pickLocation("asia", 3);
  eq(found, null, "HTTP 500 deve resultar em null");
  eq(requests.length, 3, "deveria ter tentado 3 vezes");
});

/** 5. JSON malformado: res.json() rejeitando nao pode derrubar a promessa. */
await caso("5. JSON malformado não derruba a promessa", async () => {
  setHandler(
    async () =>
      new Response("<!DOCTYPE html><html>erro do proxy</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );
  const found = await pickLocation("africa", 3);
  eq(found, null, "JSON inválido deve resultar em null");
  eq(requests.length, 3, "deveria ter tentado 3 vezes mesmo com corpo inválido");
});

/** 6. Timeout do AbortSignal conta como tentativa falha. */
await caso("6. timeout do AbortSignal conta como tentativa falha", async () => {
  let comSignal = 0;
  setHandler(async (_url, init) => {
    if (init?.signal instanceof AbortSignal) comSignal += 1;
    const erro = new Error("The operation was aborted due to timeout");
    erro.name = "TimeoutError";
    throw erro;
  });

  const found = await pickLocation("oceania", 5);
  eq(found, null, "todas em timeout deve resultar em null");
  eq(requests.length, 5, "timeout deve consumir cada tentativa");
  eq(comSignal, 5, "toda requisição deve levar um AbortSignal (timeout)");
});

/** 7. Exclusao de repetidos: pano ja usado nao pode ser escolhido de novo. */
await caso("7. exclude impede repetir um panorama já usado", async () => {
  let n = 0;
  setHandler(async () => {
    n += 1;
    // As duas primeiras respostas trazem um pano ja usado; a terceira, um novo.
    if (n < 3) return metadata({ status: "OK", pano_id: "JA_USADO", location: { lat: 1, lng: 2 } });
    return metadata({ status: "OK", pano_id: "INEDITO", location: { lat: 3, lng: 4 } });
  });

  const found = await pickLocation("world_rural", 12, new Set(["JA_USADO"]));
  eq(found?.panoId, "INEDITO", "deveria pular o panorama excluído");
  eq(requests.length, 3, "deveria ter insistido até achar um panorama inédito");

  // E se TUDO que volta esta excluido, devolve null em vez de repetir.
  setHandler(async () => metadata({ status: "OK", pano_id: "JA_USADO", location: { lat: 1, lng: 2 } }));
  const soRepetido = await pickLocation("world_rural", 4, new Set(["JA_USADO"]));
  eq(soRepetido, null, "com todos os panoramas excluídos deve devolver null");
});

/** 8. Esgotar tentativas devolve null — contrato que rooms.ts espera. */
await caso("8. esgotar as tentativas devolve null (contrato de rooms.ts)", async () => {
  setHandler(async () => metadata({ status: "ZERO_RESULTS" }));
  const found = await pickLocation("americas", 7);
  eq(found, null, "sem nenhum panorama deve devolver null");
  eq(requests.length, 7, "deveria respeitar o número de tentativas pedido");

  // Sem chave configurada nem sequer chega a chamar a API.
  const chave = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  requests = [];
  const semChave = await pickLocation("americas", 3);
  process.env.GOOGLE_MAPS_API_KEY = chave;
  eq(semChave, null, "sem chave deve devolver null");
  eq(requests.length, 0, "sem chave não deve chamar a API");
});

/** 9. O que vai na requisicao: location, source, key. */
await caso("9. requisição leva location no formato lat,lng, source=outdoor e a chave", async () => {
  setHandler(async () => metadata({ status: "ZERO_RESULTS" }));
  await pickLocation("brazil", 2);

  eq(requests.length, 2, "deveria ter feito 2 requisições");
  for (const { url } of requests) {
    eq(
      `${url.origin}${url.pathname}`,
      "https://maps.googleapis.com/maps/api/streetview/metadata",
      "endpoint da Metadata API",
    );
    const location = url.searchParams.get("location");
    check(location !== null, "parâmetro location ausente");
    check(
      /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location ?? ""),
      `location deve ser "lat,lng" (recebido: ${location})`,
    );
    eq(url.searchParams.get("source"), "outdoor", "source deve ser outdoor");
    eq(url.searchParams.get("key"), "CHAVE-DE-TESTE", "a chave deve ir na requisição");
  }
});

/** 9b. O raio precisa acompanhar a dificuldade do mapa (catalog.ts). */
await caso("9b. radius acompanha a dificuldade do mapa (10km/20km/60km)", async () => {
  const esperado: [RegionId, string, string][] = [
    ["famous", "10000", "fácil"],
    ["brazil", "10000", "fácil"],
    ["europe", "20000", "médio"],
    ["americas", "20000", "médio"],
    ["asia", "20000", "médio"],
    ["world", "20000", "médio"],
    ["africa", "60000", "difícil"],
    ["oceania", "60000", "difícil"],
    ["world_rural", "60000", "difícil"],
  ];

  for (const [region, radius, rotulo] of esperado) {
    setHandler(async () => metadata({ status: "ZERO_RESULTS" }));
    await pickLocation(region, 1);
    eq(requests[0]?.url.searchParams.get("radius"), radius, `radius de ${region} (${rotulo})`);
  }
});

/** 10. Coordenadas sempre dentro do globo, mesmo com o desvio no maximo. */
await caso("10. lat dentro de ±85 e lng dentro de ±180 com o desvio no extremo", async () => {
  const regioes: RegionId[] = [
    "world",
    "brazil",
    "europe",
    "americas",
    "asia",
    "famous",
    "africa",
    "oceania",
    "world_rural",
  ];

  let maiorLat = 0;
  for (const region of regioes) {
    setHandler(async () => metadata({ status: "ZERO_RESULTS" }));
    // Semente aleatoria, desvio sempre no maximo (alternando + e -).
    stubRandom((i, slot) => {
      if (slot === 0) return realRandom();
      return Math.floor(i / 3) % 2 === 0 ? 0 : 1 - Number.EPSILON;
    });
    await pickLocation(region, 400);
    restoreRandom();

    for (const { url } of requests) {
      const [lat, lng] = url.searchParams.get("location")!.split(",").map(Number);
      check(Number.isFinite(lat) && Number.isFinite(lng), `${region}: coordenada não numérica`);
      check(lat >= -85 && lat <= 85, `${region}: latitude fora de ±85 (${lat})`);
      check(lng >= -180 && lng <= 180, `${region}: longitude fora de ±180 (${lng})`);
      maiorLat = Math.max(maiorLat, Math.abs(lat));
    }
  }

  // Nota util para quem mexer nas sementes: hoje nenhuma chega perto do polo,
  // entao clampLat e uma rede de seguranca. Se isso mudar, o teste acima pega.
  check(maiorLat < 85, `esperava sementes longe do polo, maior |lat| observada: ${maiorLat.toFixed(4)}`);
});

/** 10b. Linha de data: a longitude precisa dar a volta, nao ser cortada. */
await caso("10b. semente na linha de data dá a volta (+180 vira -179,x)", async () => {
  setHandler(async () => metadata({ status: "ZERO_RESULTS" }));
  // Oceania (difícil, jitter 1.6°). Índice 17 de 20 = { lat: -19.0554, lng: 178.4417 }.
  // Desvio maximo para leste => 180.0417, que precisa virar -179.9583.
  stubRandom((_i, slot) => {
    if (slot === 0) return 17 / 20;
    if (slot === 1) return 0.5; // sem desvio na latitude
    return 1 - Number.EPSILON; // desvio maximo para leste na longitude
  });
  await pickLocation("oceania", 1);
  restoreRandom();

  const [lat, lng] = requests[0].url.searchParams.get("location")!.split(",").map(Number);
  check(Math.abs(lat - -19.0554) < 1e-6, `latitude deveria ficar na semente (recebido: ${lat})`);
  check(lng < 0 && lng > -180, `longitude deveria dar a volta para perto de -179,96 (recebido: ${lng})`);
  check(Math.abs(lng - -179.9583) < 0.01, `longitude esperada ≈ -179.9583 (recebido: ${lng})`);
});

// ------------------------------------------------------------------ resultado

console.log("");
if (falhas === 0) {
  console.log("Todos os casos passaram.");
  process.exit(0);
} else {
  console.log(`${falhas} caso(s) com falha.`);
  process.exit(1);
}
