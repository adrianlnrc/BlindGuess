/**
 * Teste de integração com o Maps usando um dublê da API.
 *
 * O teste de navegador (`scripts/teste-navegador.ts`) prova que as telas se
 * seguram quando a API do Google **não** carrega. Aqui provamos o caminho
 * oposto: a API carrega e o jogo funciona — sem chave e sem rede, trocando o
 * `window.google.maps` por um dublê que se comporta como a API e registra tudo
 * o que recebe.
 *
 * Os componentes são os de produção, sem nenhuma alteração: o dublê entra por
 * dois pontos que já existem no navegador.
 *
 *   1. `window.process.env` — o bundle do Next lê a chave pública em tempo de
 *      execução (`process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, servido pelo
 *      shim de `process` do webpack). Pré-popular esse objeto no
 *      `addInitScript` dá uma chave de mentira ao `loadMaps()`.
 *   2. `window.google.maps` — o `Loader` do `@googlemaps/js-api-loader` não
 *      injeta script nenhum quando já existe `google.maps.importLibrary` (e
 *      `google.maps.version`); ele só devolve o que está lá. Então o dublê
 *      colocado antes de qualquer script do app é o que os componentes usam.
 *
 * Como garantia, toda requisição para `maps.googleapis.com` é bloqueada e
 * contada: se alguma acontecer, o teste falha.
 *
 * Rodar:
 *   npx next build && npx tsx scripts/teste-integracao-maps.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getPool, migrate } from "@/server/db";
import { createChallenge } from "@/server/store";
import { DEFAULT_AVATAR, type RoomSettings } from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

// ------------------------------------------------------------------ o dublê

/** Tipos do que o dublê registra, para o lado Node conseguir afirmar sobre eles. */
type Registro = { tipo: string; dados: Record<string, unknown> | null };
type MapaDuble = {
  indice: number;
  options: Record<string, unknown>;
  centro: { lat: number; lng: number } | null;
  zoom: number | null;
};
type PanoramaDuble = {
  indice: number;
  options: Record<string, unknown>;
  pano: string | null;
  pov: { heading: number; pitch: number };
  zoom: number;
};
type MarcadorDuble = {
  indice: number;
  position: { lat: number; lng: number } | null;
  movimentos: Array<{ lat: number; lng: number } | null>;
};
type EstadoDuble = {
  registros: Registro[];
  mapas: MapaDuble[];
  panoramas: PanoramaDuble[];
  marcadores: MarcadorDuble[];
  polilinhas: number;
};

declare global {
  interface Window {
    __duble: {
      estado(): EstadoDuble;
      clicaNoMapa(indice: number, lat: number, lng: number): void;
      giraPanorama(indice: number, heading: number, pitch?: number): void;
      pronto(): { mapas: number; panoramas: number };
    };
  }
}

/**
 * Código injetado antes de qualquer script da página. Fica como texto de
 * propósito: é JavaScript de navegador, não faz parte do build do app.
 */
const FONTE_DUBLE = `
(() => {
  const registros = [];
  const reg = (tipo, dados) => registros.push({ tipo, dados: dados === undefined ? null : dados });
  const limpo = (o) => JSON.parse(JSON.stringify(o === undefined ? null : o, (k, v) => (typeof v === "function" ? "[fn]" : v)));

  class LatLngDuble {
    constructor(lat, lng) { this._lat = lat; this._lng = lng; }
    lat() { return this._lat; }
    lng() { return this._lng; }
    toJSON() { return { lat: this._lat, lng: this._lng }; }
  }

  const puro = (p) => {
    if (!p) return null;
    if (typeof p.lat === "function") return { lat: p.lat(), lng: p.lng() };
    return { lat: p.lat, lng: p.lng };
  };

  /** Registro de ouvintes, com disparo manual — é o que permite simular eventos. */
  class Ouvintes {
    constructor() { this.porTipo = {}; }
    add(tipo, fn) {
      (this.porTipo[tipo] = this.porTipo[tipo] || []).push(fn);
      const self = this;
      return { remove() { const l = self.porTipo[tipo] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
    }
    dispara(tipo, arg) {
      for (const fn of (this.porTipo[tipo] || []).slice()) fn(arg);
    }
  }

  const mapas = [];
  class MapaDuble {
    constructor(container, options) {
      this.indice = mapas.length;
      this.options = Object.assign({}, options);
      this.centro = puro(options && options.center);
      this.zoom = options && typeof options.zoom === "number" ? options.zoom : null;
      this.ouvintes = new Ouvintes();
      if (container) {
        container.setAttribute("data-duble", "mapa-" + this.indice);
        container.style.background = "#16202f";
      }
      mapas.push(this);
      reg("Map.new", { indice: this.indice, options: limpo(this.options) });
    }
    addListener(tipo, fn) { reg("Map.addListener", { tipo: tipo }); return this.ouvintes.add(tipo, fn); }
    setOptions(o) { Object.assign(this.options, o); reg("Map.setOptions", limpo(o)); }
    getCenter() { return this.centro ? new LatLngDuble(this.centro.lat, this.centro.lng) : undefined; }
    setCenter(c) { this.centro = puro(c); reg("Map.setCenter", this.centro); }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; reg("Map.setZoom", { zoom: z }); }
    fitBounds(b, p) { reg("Map.fitBounds", { padding: p === undefined ? null : p }); }
    panTo(c) { this.centro = puro(c); }
  }

  const panoramas = [];
  class PanoramaDuble {
    constructor(container, options) {
      this.indice = panoramas.length;
      this.options = Object.assign({}, options);
      this.pano = options && options.pano ? options.pano : null;
      this.pov = { heading: 0, pitch: 0 };
      this.zoom = 1;
      this.ouvintes = new Ouvintes();
      if (container) container.setAttribute("data-duble", "panorama-" + this.indice);
      panoramas.push(this);
      reg("Panorama.new", { indice: this.indice, options: limpo(this.options) });
    }
    addListener(tipo, fn) { reg("Panorama.addListener", { tipo: tipo }); return this.ouvintes.add(tipo, fn); }
    setOptions(o) { Object.assign(this.options, o); reg("Panorama.setOptions", limpo(o)); }
    setPano(id) { this.pano = id; reg("Panorama.setPano", { pano: id }); this.ouvintes.dispara("pano_changed"); }
    getPano() { return this.pano; }
    setPov(pov) {
      this.pov = { heading: pov && pov.heading, pitch: pov && pov.pitch };
      reg("Panorama.setPov", { heading: this.pov.heading, pitch: this.pov.pitch });
      this.ouvintes.dispara("pov_changed");
    }
    getPov() { return { heading: this.pov.heading, pitch: this.pov.pitch }; }
    setZoom(z) { this.zoom = z; reg("Panorama.setZoom", { zoom: z }); this.ouvintes.dispara("zoom_changed"); }
    getZoom() { return this.zoom; }
    setPosition(p) { reg("Panorama.setPosition", puro(p)); }
    setVisible(v) { reg("Panorama.setVisible", { visivel: !!v }); }
  }

  const marcadores = [];
  class MarcadorDuble {
    constructor(options) {
      this.ficha = {
        indice: marcadores.length,
        position: puro(options && options.position),
        title: (options && options.title) || null,
        movimentos: [],
      };
      marcadores.push(this.ficha);
      reg("Marker.new", { indice: this.ficha.indice, position: this.ficha.position });
    }
    setPosition(p) {
      const pos = puro(p);
      this.ficha.position = pos;
      this.ficha.movimentos.push(pos);
      reg("Marker.setPosition", pos);
    }
    getPosition() { return this.ficha.position ? new LatLngDuble(this.ficha.position.lat, this.ficha.position.lng) : null; }
    setMap(m) { reg("Marker.setMap", { removido: m === null }); }
    setIcon() {}
    setTitle() {}
    addListener(tipo, fn) { return { remove() {} }; }
  }

  let polilinhas = 0;
  class PolilinhaDuble {
    constructor(options) { polilinhas += 1; reg("Polyline.new", { pontos: (options && options.path ? options.path.length : 0) }); }
    setMap(m) {}
  }

  class LimitesDuble {
    constructor() { this.pontos = []; }
    extend(p) { this.pontos.push(puro(p)); return this; }
    getCenter() { return new LatLngDuble(0, 0); }
    isEmpty() { return this.pontos.length === 0; }
  }

  const event = {
    trigger(obj, tipo, arg) {
      reg("event.trigger", { tipo: tipo, alvo: obj && obj.constructor ? obj.constructor.name : null });
      if (obj && obj.ouvintes) obj.ouvintes.dispara(tipo, arg);
    },
    addListener(obj, tipo, fn) { return obj.addListener(tipo, fn); },
    removeListener(l) { if (l && l.remove) l.remove(); },
    clearInstanceListeners() {},
  };

  const maps = {
    Map: MapaDuble,
    StreetViewPanorama: PanoramaDuble,
    Marker: MarcadorDuble,
    Polyline: PolilinhaDuble,
    LatLng: LatLngDuble,
    LatLngBounds: LimitesDuble,
    SymbolPath: { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1, FORWARD_OPEN_ARROW: 2, BACKWARD_CLOSED_ARROW: 3, BACKWARD_OPEN_ARROW: 4 },
    MapTypeId: { ROADMAP: "roadmap" },
    event: event,
    version: "3.duble",
    importLibrary(nome) { reg("importLibrary", { nome: nome }); return Promise.resolve(maps); },
  };

  window.google = Object.assign({}, window.google, { maps: maps });

  /** A chave pública é lida em tempo de execução do shim de process do bundle. */
  const env = Object.assign({ NODE_ENV: "production" }, window.process && window.process.env);
  env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "chave-do-duble";
  window.process = Object.assign({ browser: true, nextTick: (cb) => Promise.resolve().then(cb) }, window.process, { env: env });

  window.__duble = {
    estado() {
      return JSON.parse(JSON.stringify({
        registros: registros,
        mapas: mapas.map((m) => ({ indice: m.indice, options: limpo(m.options), centro: m.centro, zoom: m.zoom })),
        panoramas: panoramas.map((p) => ({ indice: p.indice, options: limpo(p.options), pano: p.pano, pov: p.pov, zoom: p.zoom })),
        marcadores: marcadores,
        polilinhas: polilinhas,
      }));
    },
    clicaNoMapa(indice, lat, lng) {
      const m = mapas[indice];
      if (!m) throw new Error("não existe mapa de índice " + indice);
      m.ouvintes.dispara("click", { latLng: new LatLngDuble(lat, lng) });
    },
    giraPanorama(indice, heading, pitch) {
      const p = panoramas[indice];
      if (!p) throw new Error("não existe panorama de índice " + indice);
      p.setPov({ heading: heading, pitch: pitch || 0 });
    },
    pronto() { return { mapas: mapas.length, panoramas: panoramas.length }; },
  };
})();
`;

// ------------------------------------------------------- relatório e asserts

type Resultado = { nome: string; ok: boolean; detalhe: string };
const resultados: Resultado[] = [];

async function verifica(nome: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detalhe = await fn();
    resultados.push({ nome, ok: true, detalhe });
    console.log(`  ok   ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    resultados.push({ nome, ok: false, detalhe });
    console.log(`  FALHA ${nome} — ${detalhe}`);
  }
}

function exige(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(mensagem);
}

// ------------------------------------------------------------------ servidor

/**
 * O servidor sorteia os locais das salas normais chamando a API de metadados do
 * Street View. Sem chave isso devolve null e a sala nunca sai do "procurando".
 * Para a sala com amigos (a única forma de ver o palpite de um jogador com a
 * rodada ainda aberta) trocamos esse `fetch` por um dublê — só para o domínio do
 * Google, e só no processo do servidor de teste.
 */
const PANO_SALA = "duble-pano-sala";
const LOCAL_SALA = { lat: -22.9519, lng: -43.2105 };

function escreveDubleDeFetch(): string {
  const dir = mkdtempSync(join(tmpdir(), "blindguess-duble-"));
  const arquivo = join(dir, "duble-fetch.mjs");
  writeFileSync(
    arquivo,
    `const original = globalThis.fetch;
const resposta = ${JSON.stringify({
      status: "OK",
      pano_id: PANO_SALA,
      location: LOCAL_SALA,
    })};
globalThis.fetch = async (entrada, init) => {
  const url = String(typeof entrada === "string" ? entrada : entrada && entrada.url ? entrada.url : entrada);
  if (url.includes("maps.googleapis.com")) {
    return new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } });
  }
  return original(entrada, init);
};
console.log("[duble] fetch do Street View trocado pelo dublê");
`,
  );
  return arquivo;
}

function sobeServidor(dubleDeFetch: string): ChildProcess {
  const server = spawn("node_modules/.bin/tsx", ["server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${new URL(`file://${dubleDeFetch}`).href}`.trim(),
      PORT: String(PORT),
      DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "teste",
      // Só precisa existir: quem responde é o dublê de fetch acima.
      GOOGLE_MAPS_API_KEY: "chave-do-duble",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout?.on("data", (d: Buffer) => process.env.VERBOSE && process.stdout.write(`[srv] ${d}`));
  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[srv] ${d}`));
  return server;
}

async function esperaServidor(timeoutMs = 90_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await sleep(500);
  }
  throw new Error(`servidor não respondeu em ${BASE} dentro do tempo`);
}

// ------------------------------------------------------------------ desafios

const LOCAIS_FIXOS = [
  { lat: -23.5505, lng: -46.6333, panoId: "duble-pano-sao-paulo" },
  { lat: 48.8566, lng: 2.3522, panoId: "duble-pano-paris" },
];

const REGRAS_LIBERADAS: RoomSettings = {
  rounds: LOCAIS_FIXOS.length,
  roundSeconds: 600,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

const REGRAS_TRAVADAS: RoomSettings = {
  ...REGRAS_LIBERADAS,
  allowMove: false,
  allowPan: false,
  allowZoom: false,
};

async function semeiaDesafio(settings: RoomSettings, autor: string): Promise<string> {
  return createChallenge({
    creator: { id: autor, name: "Teste de integração", avatar: { ...DEFAULT_AVATAR } },
    settings,
    locations: LOCAIS_FIXOS,
  });
}

// -------------------------------------------------------------------- página

/** Requisições que escaparem para o Google de verdade viram falha. */
const vazamentos: string[] = [];

async function novoContexto(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript({ content: FONTE_DUBLE });
  await context.route("**://*.googleapis.com/**", (route) => {
    vazamentos.push(route.request().url());
    return route.abort();
  });
  return context;
}

async function preparaPerfil(page: Page, apelido: string): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const campo = page.locator("#nickname");
  await campo.waitFor({ state: "visible", timeout: 20_000 });
  await campo.fill(apelido);
  await page.waitForFunction(
    (nome) => (window.localStorage.getItem("blindguess:profile") ?? "").includes(nome),
    apelido,
    { timeout: 10_000 },
  );
}

/** Aceita o desafio e chega na tela de jogo, com o dublê já instanciado. */
async function entraNoDesafio(page: Page, codigo: string, apelido: string): Promise<void> {
  await preparaPerfil(page, apelido);
  await page.goto(`${BASE}/desafio/${codigo}`, { waitUntil: "domcontentloaded" });

  const aceitar = page.getByRole("button", { name: /Aceitar o desafio|Jogar de novo/ });
  await aceitar.waitFor({ timeout: 20_000 });
  await aceitar.click();
  await page.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });

  const comecar = page.getByRole("button", { name: "Jogar o desafio" });
  await comecar.waitFor({ timeout: 20_000 });
  await comecar.click();

  await page.waitForFunction(
    () => {
      const p = window.__duble.pronto();
      return p.mapas > 0 && p.panoramas > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
}

const botaoPalpite = (page: Page) => page.getByRole("button", { name: /palpit/i });

function registrosDe(estado: EstadoDuble, tipo: string): Registro[] {
  return estado.registros.filter((r) => r.tipo === tipo);
}

// ----------------------------------------------------------------- execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;

  const dubleDeFetch = escreveDubleDeFetch();
  console.log("> subindo o servidor…");
  const server = sobeServidor(dubleDeFetch);
  let browser: Browser | null = null;

  try {
    await esperaServidor();
    console.log(`> servidor no ar em ${BASE}`);

    await migrate();
    const desafioLiberado = await semeiaDesafio(REGRAS_LIBERADAS, "duble-autor-liberado");
    const desafioTravado = await semeiaDesafio(REGRAS_TRAVADAS, "duble-autor-travado");
    console.log(`> desafios semeados: ${desafioLiberado} (liberado) e ${desafioTravado} (travado)`);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

    // ---------------------------------------------------------------- sala liberada
    const context = await novoContexto(browser);
    const page = await context.newPage();
    const erros: string[] = [];
    page.on("pageerror", (err) => erros.push(`pageerror: ${err.message}`));

    console.log("\n[0] o dublê entra no lugar da API");
    await verifica("componentes reais rodam contra o dublê", async () => {
      await entraNoDesafio(page, desafioLiberado, "dubleliberado");

      const estado = await page.evaluate(() => window.__duble.estado());
      exige(estado.panoramas.length === 1, `panoramas criados: ${estado.panoramas.length}`);
      exige(estado.mapas.length === 1, `mapas criados: ${estado.mapas.length}`);
      exige(
        estado.panoramas[0].pano === LOCAIS_FIXOS[0].panoId,
        `panorama aberto no pano errado: ${estado.panoramas[0].pano}`,
      );
      exige(
        (await page.locator("text=Não deu para carregar o panorama").count()) === 0,
        "a tela ainda mostra a mensagem de falha do panorama",
      );
      exige(
        (await page.locator("text=Não deu para carregar o mapa").count()) === 0,
        "a tela ainda mostra a mensagem de falha do mapa",
      );
      exige(vazamentos.length === 0, `requisições para o Google: ${vazamentos.join(", ")}`);
      exige(erros.length === 0, erros.join(" | "));

      return `1 panorama (${estado.panoramas[0].pano}) e 1 mapa, sem nenhuma chamada ao Google`;
    });

    console.log("\n[1] palpite: clique no mapa habilita o botão e move o marcador");
    await verifica("dois cliques → um único Marker, reposicionado", async () => {
      const antes = (await botaoPalpite(page).innerText()).trim();
      exige(
        /Clique no mapa para palpitar/i.test(antes),
        `o botão já começava habilitado: "${antes}"`,
      );
      exige(await botaoPalpite(page).isDisabled(), "o botão de confirmar não começa desabilitado");

      await page.evaluate(() => window.__duble.clicaNoMapa(0, -23.4, -46.5));
      await page.waitForFunction(
        () => /confirmar palpite/i.test(document.body.innerText),
        undefined,
        { timeout: 10_000 },
      );
      exige(!(await botaoPalpite(page).isDisabled()), "o botão continuou desabilitado após o clique");

      await page.evaluate(() => window.__duble.clicaNoMapa(0, 10.25, 20.5));
      await page.waitForTimeout(300);

      const estado = await page.evaluate(() => window.__duble.estado());
      exige(
        estado.marcadores.length === 1,
        `o segundo clique criou outro marcador: ${estado.marcadores.length} marcadores`,
      );

      const marcador = estado.marcadores[0];
      exige(
        marcador.movimentos.length === 1,
        `setPosition chamado ${marcador.movimentos.length} vezes`,
      );
      exige(
        marcador.position?.lat === 10.25 && marcador.position?.lng === 20.5,
        `marcador na posição errada: ${JSON.stringify(marcador.position)}`,
      );

      const depois = (await botaoPalpite(page).innerText()).trim();
      exige(/Confirmar palpite/i.test(depois), `o botão não virou confirmar: "${depois}"`);

      return `botão "${depois.replace(/\s+/g, " ")}", 1 Marker criado e movido para (10.25, 20.5)`;
    });

    console.log("\n[3] bússola gira com o pov_changed");
    let headingInicial = 0;
    await verifica("pov_changed com heading conhecido gira a agulha", async () => {
      const estado = await page.evaluate(() => window.__duble.estado());
      const povs = registrosDe(estado, "Panorama.setPov");
      exige(povs.length > 0, "o componente não definiu nenhum ângulo inicial");
      headingInicial = povs[0].dados?.heading as number;

      const agulha = page
        .getByRole("button", { name: "Olhar para o norte" })
        .locator("svg > g")
        .first();
      const transformInicial = await agulha.getAttribute("transform");
      exige(
        transformInicial === `rotate(${-headingInicial} 24 24)`,
        `a bússola não começou no ângulo inicial: ${transformInicial} (esperado rotate(${-headingInicial} 24 24))`,
      );

      await page.evaluate(() => window.__duble.giraPanorama(0, 137.5, 0));
      await page.waitForFunction(
        () => {
          const g = document.querySelector('button[aria-label="Olhar para o norte"] svg > g');
          return g?.getAttribute("transform") === "rotate(-137.5 24 24)";
        },
        undefined,
        { timeout: 10_000 },
      );

      // E o botão da bússola volta o olhar para o norte.
      await page.getByRole("button", { name: "Olhar para o norte" }).click();
      await page.waitForFunction(
        () => {
          const g = document.querySelector('button[aria-label="Olhar para o norte"] svg > g');
          return g?.getAttribute("transform") === "rotate(0 24 24)";
        },
        undefined,
        { timeout: 10_000 },
      );

      return `heading inicial ${headingInicial.toFixed(1)}° → 137.5° (rotate(-137.5 24 24)) → norte (rotate(0 24 24))`;
    });

    console.log("\n[4] voltar ao ponto inicial");
    await verifica("setPano com o pano inicial e setPov com o ângulo guardado", async () => {
      const marcaAntes = (await page.evaluate(() => window.__duble.estado())).registros.length;

      await page.getByRole("button", { name: "Voltar ao ponto inicial" }).click();
      await page.waitForTimeout(300);

      const estado = await page.evaluate(() => window.__duble.estado());
      const novos = estado.registros.slice(marcaAntes);

      const panos = novos.filter((r) => r.tipo === "Panorama.setPano");
      exige(panos.length === 1, `setPano chamado ${panos.length} vezes`);
      exige(
        panos[0].dados?.pano === LOCAIS_FIXOS[0].panoId,
        `setPano com o pano errado: ${panos[0].dados?.pano}`,
      );

      const povs = novos.filter((r) => r.tipo === "Panorama.setPov");
      exige(povs.length === 1, `setPov chamado ${povs.length} vezes`);
      exige(
        povs[0].dados?.heading === headingInicial && povs[0].dados?.pitch === 0,
        `setPov com ângulo errado: ${JSON.stringify(povs[0].dados)}`,
      );

      const agulha = await page
        .getByRole("button", { name: "Olhar para o norte" })
        .locator("svg > g")
        .first()
        .getAttribute("transform");
      exige(
        agulha === `rotate(${-headingInicial} 24 24)`,
        `a bússola não voltou ao ângulo inicial: ${agulha}`,
      );

      return `setPano("${LOCAIS_FIXOS[0].panoId}") e setPov(${headingInicial.toFixed(1)}°, 0°) restaurados`;
    });

    console.log("\n[5] zoom do panorama respeita os limites");
    await verifica("setZoom nunca sai do intervalo 0–4", async () => {
      const marcaAntes = (await page.evaluate(() => window.__duble.estado())).registros.length;

      const mais = page.getByRole("button", { name: "Aproximar" });
      const menos = page.getByRole("button", { name: "Afastar" });
      for (let i = 0; i < 6; i++) await mais.click();
      for (let i = 0; i < 9; i++) await menos.click();
      await page.waitForTimeout(300);

      const estado = await page.evaluate(() => window.__duble.estado());
      const zooms = estado.registros
        .slice(marcaAntes)
        .filter((r) => r.tipo === "Panorama.setZoom")
        .map((r) => r.dados?.zoom as number);

      exige(zooms.length === 15, `esperava 15 chamadas de setZoom, vieram ${zooms.length}`);
      const foraDoLimite = zooms.filter((z) => z < 0 || z > 4);
      exige(foraDoLimite.length === 0, `zoom fora dos limites: ${foraDoLimite.join(", ")}`);
      exige(zooms.includes(4), "o botão de aproximar não chegou no limite de 4");
      exige(zooms.includes(0), "o botão de afastar não chegou no limite de 0");
      exige(estado.panoramas[0].zoom === 0, `zoom final inesperado: ${estado.panoramas[0].zoom}`);

      return `6 cliques em + e 9 em −: ${zooms.join(",")}`;
    });

    console.log("\n[7] o mapa recalcula o tamanho quando a caixa muda");
    await verifica("mudar o tamanho dispara resize e mantém o centro", async () => {
      await page.evaluate(() => window.__duble.clicaNoMapa(0, 5, 5));
      await page.waitForTimeout(200);
      const marcaAntes = (await page.evaluate(() => window.__duble.estado())).registros.length;

      await page.getByRole("button", { name: /Aumentar o mapa|Reduzir o mapa/ }).click();
      await page.waitForTimeout(600);

      const estado = await page.evaluate(() => window.__duble.estado());
      const novos = estado.registros.slice(marcaAntes);
      const resizes = novos.filter((r) => r.tipo === "event.trigger" && r.dados?.tipo === "resize");
      exige(resizes.length >= 1, "mudar o tamanho não disparou o resize do mapa");

      const centros = novos.filter((r) => r.tipo === "Map.setCenter");
      exige(centros.length >= 1, "o centro do mapa não foi restaurado depois do resize");
      exige(
        centros[centros.length - 1].dados?.lat === estado.mapas[0].centro?.lat,
        "o centro restaurado não bate com o centro do mapa",
      );

      return `${resizes.length} resize(s) e o centro reaplicado em ${JSON.stringify(estado.mapas[0].centro)}`;
    });

    exige(erros.length === 0, `exceções de página na sala liberada: ${erros.join(" | ")}`);
    await context.close();

    // ---------------------------------------------------------------- regras da sala
    console.log("\n[6] regras da sala viram opções do panorama");
    await verifica("allowMove/allowZoom desligados travam o panorama", async () => {
      const ctx = await novoContexto(browser!);
      const p = await ctx.newPage();
      const errosSala: string[] = [];
      p.on("pageerror", (err) => errosSala.push(`pageerror: ${err.message}`));

      await entraNoDesafio(p, desafioTravado, "dubletravado");
      const estado = await p.evaluate(() => window.__duble.estado());
      const opcoes = estado.panoramas[0].options;

      exige(opcoes.clickToGo === false, `clickToGo deveria ser false, veio ${opcoes.clickToGo}`);
      exige(opcoes.linksControl === false, `linksControl deveria ser false, veio ${opcoes.linksControl}`);
      exige(opcoes.scrollwheel === false, `scrollwheel deveria ser false, veio ${opcoes.scrollwheel}`);
      exige(
        (await p.getByRole("button", { name: "Aproximar" }).count()) === 0,
        "os botões de zoom apareceram com allowZoom desligado",
      );

      // Sem pan, a camada que engole o arrasto tem que estar lá.
      exige(
        (await p.locator("div.absolute.inset-0.cursor-not-allowed").count()) === 1,
        "a camada que bloqueia o arrasto não está na tela com allowPan desligado",
      );
      exige(errosSala.length === 0, errosSala.join(" | "));

      await ctx.close();
      return "clickToGo, linksControl e scrollwheel = false; sem botões de zoom; camada sem pan presente";
    });

    // ---------------------------------------------------------------- sala com amigos
    console.log("\n[2] confirmar envia o palpite (sala com dois jogadores)");
    await verifica("espaço confirma → 'Palpite enviado' e o outro jogador fica pendente", async () => {
      const ctxA = await novoContexto(browser!);
      const ctxB = await novoContexto(browser!);
      const pa = await ctxA.newPage();
      const pb = await ctxB.newPage();
      const errosSala: string[] = [];
      pa.on("pageerror", (err) => errosSala.push(`A pageerror: ${err.message}`));
      pb.on("pageerror", (err) => errosSala.push(`B pageerror: ${err.message}`));

      try {
        await preparaPerfil(pa, "dubleanfitriao");
        await preparaPerfil(pb, "dubleconvidado");

        await pa.getByRole("button", { name: "Criar sala" }).click();
        await pa.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });
        const codigo = pa.url().split("/").pop()!;

        await pb.locator("#code").fill(codigo);
        await pb.getByRole("button", { name: "Entrar" }).click();
        await pb.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });

        // O anfitrião só começa depois de ver os dois na sala.
        await pa.locator("text=dubleconvidado").first().waitFor({ timeout: 20_000 });
        await pa.getByRole("button", { name: "Começar partida" }).click();

        await pa.waitForFunction(
          () => {
            const d = window.__duble.pronto();
            return d.mapas > 0 && d.panoramas > 0;
          },
          undefined,
          { timeout: 30_000 },
        );

        const estadoA = await pa.evaluate(() => window.__duble.estado());
        exige(
          estadoA.panoramas[0].pano === PANO_SALA,
          `a sala abriu no pano ${estadoA.panoramas[0].pano}, esperado ${PANO_SALA}`,
        );

        await pa.evaluate(() => window.__duble.clicaNoMapa(0, -22.9, -43.2));
        await pa.waitForFunction(
          () => /confirmar palpite/i.test(document.body.innerText),
          undefined,
          { timeout: 10_000 },
        );

        // Espaço confirma sem tirar a mão do mouse.
        await pa.keyboard.press("Space");

        await pa.waitForFunction(
          () => /palpite enviado/i.test(document.body.innerText),
          undefined,
          { timeout: 15_000 },
        );

        const rotulo = (await botaoPalpite(pa).innerText()).trim();
        exige(await botaoPalpite(pa).isDisabled(), "o botão continuou clicável depois de enviar");

        const corpoA = await pa.locator("body").innerText();
        exige(/Esperando:/i.test(corpoA), "a tela não mostra quem ainda falta palpitar");
        exige(/dubleconvidado/i.test(corpoA), "o jogador pendente não aparece na lista de espera");

        // O servidor recebeu mesmo: o contador de palpites do outro jogador subiu.
        await pb.waitForFunction(
          () => /palpitaram/i.test(document.body.innerText),
          undefined,
          { timeout: 15_000 },
        );
        const contador = await pb.evaluate(() => {
          const el = Array.from(document.querySelectorAll("div")).find((d) =>
            /palpitaram/i.test(d.textContent ?? ""),
          );
          return el?.textContent ?? "";
        });
        exige(/1\s*\/\s*2/.test(contador), `o contador não marcou 1/2: "${contador.trim()}"`);
        exige(errosSala.length === 0, errosSala.join(" | "));

        return `botão "${rotulo}", lista de espera com o convidado e contador ${contador.replace(/\s+/g, " ").trim()}`;
      } finally {
        await ctxA.close().catch(() => {});
        await ctxB.close().catch(() => {});
      }
    });

    await verifica("nenhuma requisição escapou para o Google", async () => {
      exige(vazamentos.length === 0, `requisições bloqueadas: ${vazamentos.join(", ")}`);
      return "0 requisições para *.googleapis.com";
    });
  } finally {
    await browser?.close().catch(() => {});
    server.kill("SIGTERM");
    await sleep(800);
    if (!server.killed) server.kill("SIGKILL");
    await getPool().end().catch(() => {});
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  for (const f of falhas) console.log(`  FALHA ${f.nome} — ${f.detalhe}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro fatal no teste de integração com o Maps:", err);
  process.exit(1);
});
