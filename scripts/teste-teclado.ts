/**
 * Teste do teclado do panorama e da colisão de HUD da tela de jogo.
 *
 * O dublê de `window.google.maps` é o mesmo truque de
 * `scripts/teste-integracao-maps.ts` (a API do Google nunca é chamada: quem
 * responde é um dublê injetado antes de qualquer script da página), com uma
 * peça a mais — o panorama aqui tem **links**, que é o que W/S percorrem. O
 * dublê registra todo `setPov`, `setPano` e `setZoom`, e é isso que prova que a
 * tecla fez (ou não fez) o que devia.
 *
 * A segunda metade do arquivo mede o HUD: o painel "Esperando: …" e a bússola
 * moravam os dois em `bottom-4 left-4` e se cobriam depois do palpite numa sala
 * com amigos. Aqui a prova é geométrica, com `getBoundingClientRect()` dos dois
 * elementos em 1440×900 e em 390×844 — e as capturas ficam em `design/hud/`.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx next build && npx tsx scripts/teste-teclado.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getPool, migrate } from "@/server/db";
import { createChallenge } from "@/server/store";
import { DEFAULT_AVATAR, type RoomSettings } from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3600);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const RAIZ = new URL("..", import.meta.url).pathname;
const PASTA_CAPTURAS = join(RAIZ, "design/hud");

/** Tempo com a tecla presa: sobra para vários quadros de `requestAnimationFrame`. */
const TECLA_PRESA_MS = 260;

// ------------------------------------------------------------------ o dublê

type Registro = { tipo: string; dados: Record<string, unknown> | null };
type PanoramaDuble = {
  indice: number;
  options: Record<string, unknown>;
  pano: string | null;
  pov: { heading: number; pitch: number };
  zoom: number;
};
type EstadoDuble = {
  registros: Registro[];
  panoramas: PanoramaDuble[];
  mapas: number;
};

declare global {
  interface Window {
    __dubleTeclado: {
      estado(): EstadoDuble;
      clicaNoMapa(indice: number, lat: number, lng: number): void;
      defineLinks(indice: number, links: Array<{ heading: number; pano: string }>): void;
      pronto(): { mapas: number; panoramas: number };
      campoDeTexto(): void;
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
      reg("Map.new", { indice: this.indice });
    }
    addListener(tipo, fn) { return this.ouvintes.add(tipo, fn); }
    setOptions(o) { Object.assign(this.options, o); }
    getCenter() { return this.centro ? new LatLngDuble(this.centro.lat, this.centro.lng) : undefined; }
    setCenter(c) { this.centro = puro(c); }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; }
    fitBounds() {}
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
      /** Vizinhos do panorama: é o que W/S percorrem. O teste define quais são. */
      this.links = [];
      this.ouvintes = new Ouvintes();
      if (container) container.setAttribute("data-duble", "panorama-" + this.indice);
      panoramas.push(this);
      reg("Panorama.new", { indice: this.indice, options: limpo(this.options) });
    }
    addListener(tipo, fn) { return this.ouvintes.add(tipo, fn); }
    setOptions(o) { Object.assign(this.options, o); reg("Panorama.setOptions", limpo(o)); }
    setPano(id) { this.pano = id; reg("Panorama.setPano", { pano: id }); this.ouvintes.dispara("pano_changed"); }
    getPano() { return this.pano; }
    getLinks() { return this.links.slice(); }
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
      this.ficha = { indice: marcadores.length, position: puro(options && options.position) };
      marcadores.push(this.ficha);
    }
    setPosition(p) { this.ficha.position = puro(p); }
    getPosition() { return this.ficha.position ? new LatLngDuble(this.ficha.position.lat, this.ficha.position.lng) : null; }
    setMap() {}
    setIcon() {}
    setTitle() {}
    addListener() { return { remove() {} }; }
  }

  class PolilinhaDuble { constructor() {} setMap() {} }

  class LimitesDuble {
    constructor() { this.pontos = []; }
    extend(p) { this.pontos.push(puro(p)); return this; }
    getCenter() { return new LatLngDuble(0, 0); }
    isEmpty() { return this.pontos.length === 0; }
  }

  const event = {
    trigger(obj, tipo, arg) { if (obj && obj.ouvintes) obj.ouvintes.dispara(tipo, arg); },
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
    importLibrary() { return Promise.resolve(maps); },
  };

  window.google = Object.assign({}, window.google, { maps: maps });

  const env = Object.assign({ NODE_ENV: "production" }, window.process && window.process.env);
  env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "chave-do-duble";
  window.process = Object.assign({ browser: true, nextTick: (cb) => Promise.resolve().then(cb) }, window.process, { env: env });

  window.__dubleTeclado = {
    estado() {
      return JSON.parse(JSON.stringify({
        registros: registros,
        panoramas: panoramas.map((p) => ({ indice: p.indice, options: limpo(p.options), pano: p.pano, pov: p.pov, zoom: p.zoom })),
        mapas: mapas.length,
      }));
    },
    clicaNoMapa(indice, lat, lng) {
      const m = mapas[indice];
      if (!m) throw new Error("não existe mapa de índice " + indice);
      m.ouvintes.dispara("click", { latLng: new LatLngDuble(lat, lng) });
    },
    defineLinks(indice, links) {
      const p = panoramas[indice];
      if (!p) throw new Error("não existe panorama de índice " + indice);
      p.links = links.map((l) => ({ heading: l.heading, pano: l.pano, description: l.pano }));
    },
    pronto() { return { mapas: mapas.length, panoramas: panoramas.length }; },
    /**
     * Um campo de texto focado, no lugar do campo do chat da sala: com o foco
     * nele, nenhuma tecla pode chegar no panorama.
     */
    campoDeTexto() {
      const campo = document.createElement("input");
      campo.type = "text";
      campo.id = "campo-do-duble";
      document.body.appendChild(campo);
      campo.focus();
    },
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
 * A sala com amigos (a única em que dá para ver o painel "Esperando" com a
 * rodada aberta) precisa que o servidor sorteie um panorama, e isso é um
 * `fetch` na API de metadados do Street View. Sem chave ele devolve null e a
 * sala nunca sai do "procurando" — então o `fetch` do processo do servidor de
 * teste também ganha um dublê, só para o domínio do Google.
 */
const PANO_SALA = "duble-pano-sala";
const LOCAL_SALA = { lat: -22.9519, lng: -43.2105 };

function escreveDubleDeFetch(): string {
  const dir = mkdtempSync(join(tmpdir(), "blindguess-teclado-"));
  const arquivo = join(dir, "duble-fetch.mjs");
  writeFileSync(
    arquivo,
    `const original = globalThis.fetch;
const resposta = ${JSON.stringify({ status: "OK", pano_id: PANO_SALA, location: LOCAL_SALA })};
globalThis.fetch = async (entrada, init) => {
  const url = String(typeof entrada === "string" ? entrada : entrada && entrada.url ? entrada.url : entrada);
  if (url.includes("maps.googleapis.com")) {
    return new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } });
  }
  return original(entrada, init);
};
`,
  );
  return arquivo;
}

function sobeServidor(dubleDeFetch: string): ChildProcess {
  const server = spawn("node_modules/.bin/tsx", ["server.ts"], {
    cwd: RAIZ,
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
    creator: { id: autor, name: "Teste de teclado", avatar: { ...DEFAULT_AVATAR } },
    settings,
    locations: LOCAIS_FIXOS,
  });
}

// -------------------------------------------------------------------- página

/** Requisições que escaparem para o Google de verdade viram falha. */
const vazamentos: string[] = [];

async function novoContexto(
  browser: Browser,
  viewport?: { width: number; height: number },
): Promise<BrowserContext> {
  const context = await browser.newContext(viewport ? { viewport } : {});
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

async function esperaPanorama(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = window.__dubleTeclado.pronto();
      return p.mapas > 0 && p.panoramas > 0;
    },
    undefined,
    { timeout: 30_000 },
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

  await esperaPanorama(page);
}

const estadoDe = (page: Page) => page.evaluate(() => window.__dubleTeclado.estado());

/** Segura a tecla o tempo de vários quadros e solta — é o giro contínuo. */
async function seguraTecla(page: Page, tecla: string, ms = TECLA_PRESA_MS): Promise<void> {
  await page.keyboard.down(tecla);
  await page.waitForTimeout(ms);
  await page.keyboard.up(tecla);
  await page.waitForTimeout(80);
}

async function novosRegistros(page: Page, marca: number, tipo: string): Promise<Registro[]> {
  const estado = await estadoDe(page);
  return estado.registros.slice(marca).filter((r) => r.tipo === tipo);
}

const marcaDe = async (page: Page) => (await estadoDe(page)).registros.length;

// --------------------------------------------------------------- HUD medido

type Caixa = { x: number; y: number; width: number; height: number };

/** Retângulo de um seletor, do jeito que o navegador desenhou. */
async function caixaDe(page: Page, seletor: string): Promise<Caixa> {
  const caixa = await page.locator(seletor).first().boundingBox();
  exige(caixa, `elemento não está na tela: ${seletor}`);
  return { x: caixa.x, y: caixa.y, width: caixa.width, height: caixa.height };
}

/** Painel "Esperando: …": achado pelo texto, não por posição. */
async function caixaDoEsperando(page: Page): Promise<Caixa> {
  const caixa = await page
    .locator("div.panel", { has: page.locator("p", { hasText: /^Esperando:$/ }) })
    .first()
    .boundingBox();
  exige(caixa, 'o painel "Esperando" não está na tela');
  return { x: caixa.x, y: caixa.y, width: caixa.width, height: caixa.height };
}

function seCruzam(a: Caixa, b: Caixa): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

const escreveCaixa = (c: Caixa) =>
  `x ${Math.round(c.x)}..${Math.round(c.x + c.width)}, y ${Math.round(c.y)}..${Math.round(c.y + c.height)}`;

/**
 * Sala com dois jogadores, o anfitrião já tendo palpitado: é o único estado em
 * que o painel "Esperando" e a bússola aparecem juntos na tela.
 */
async function salaComEsperando(
  browser: Browser,
  viewport: { width: number; height: number },
  sufixo: string,
): Promise<{ contextos: BrowserContext[]; anfitriao: Page; erros: string[] }> {
  const ctxA = await novoContexto(browser, viewport);
  const ctxB = await novoContexto(browser, viewport);
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  const erros: string[] = [];
  pa.on("pageerror", (err) => erros.push(`A pageerror: ${err.message}`));
  pb.on("pageerror", (err) => erros.push(`B pageerror: ${err.message}`));

  // Apelidos curtos: o campo da home corta em 18 caracteres e o perfil salvo
  // não bateria com o que foi digitado.
  await preparaPerfil(pa, `hud${sufixo}dono`);
  await preparaPerfil(pb, `hud${sufixo}visita`);

  await pa.getByRole("button", { name: "Criar sala" }).click();
  await pa.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });
  const codigo = pa.url().split("/").pop()!;

  await pb.locator("#code").fill(codigo);
  await pb.getByRole("button", { name: "Entrar" }).click();
  await pb.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });

  await pa.locator(`text=hud${sufixo}visita`).first().waitFor({ timeout: 20_000 });
  await pa.getByRole("button", { name: "Começar partida" }).click();
  await esperaPanorama(pa);

  // Palpita para o painel "Esperando" aparecer: o convidado fica pendente.
  await pa.evaluate(() => window.__dubleTeclado.clicaNoMapa(0, -22.9, -43.2));
  await pa.waitForFunction(() => /confirmar palpite/i.test(document.body.innerText), undefined, {
    timeout: 10_000,
  });
  await pa.keyboard.press("Space");
  await pa.waitForFunction(() => /Esperando:/i.test(document.body.innerText), undefined, {
    timeout: 20_000,
  });

  // O ponteiro fica onde o último clique o deixou, e no celular isso cai dentro
  // do mini-mapa — que cresce um degrau com o mouse por cima e aí cobre mesmo os
  // controles do panorama (é gesto do jogador, e o mini-mapa é de outro arquivo).
  // Tira o mouse do caminho e espera a animação de tamanho acabar: o que se mede
  // aqui é o HUD em repouso.
  await pa.mouse.move(2, 2);
  await pa.waitForTimeout(500);

  return { contextos: [ctxA, ctxB], anfitriao: pa, erros };
}

// ----------------------------------------------------------------- execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;
  mkdirSync(PASTA_CAPTURAS, { recursive: true });

  const dubleDeFetch = escreveDubleDeFetch();
  console.log("> subindo o servidor…");
  const server = sobeServidor(dubleDeFetch);
  let browser: Browser | null = null;

  try {
    await esperaServidor();
    console.log(`> servidor no ar em ${BASE}`);

    await migrate();
    const desafioLiberado = await semeiaDesafio(REGRAS_LIBERADAS, "teclado-autor-liberado");
    const desafioTravado = await semeiaDesafio(REGRAS_TRAVADAS, "teclado-autor-travado");
    console.log(`> desafios semeados: ${desafioLiberado} (liberado) e ${desafioTravado} (travado)`);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

    // ------------------------------------------------- sala com tudo liberado
    const context = await novoContexto(browser, { width: 1440, height: 900 });
    const page = await context.newPage();
    const erros: string[] = [];
    page.on("pageerror", (err) => erros.push(`pageerror: ${err.message}`));

    console.log("\n[1] setas giram e inclinam a câmera");
    await verifica("←/→ mudam o heading de forma contínua", async () => {
      await entraNoDesafio(page, desafioLiberado, "tecladoliberado");

      const antes = (await estadoDe(page)).panoramas[0].pov.heading;
      const marca = await marcaDe(page);

      await seguraTecla(page, "ArrowRight");
      const direita = (await estadoDe(page)).panoramas[0].pov.heading;
      const povs = await novosRegistros(page, marca, "Panorama.setPov");

      exige(povs.length > 3, `esperava vários setPov no giro contínuo, vieram ${povs.length}`);
      const deltaDireita = ((direita - antes + 540) % 360) - 180;
      exige(deltaDireita > 5, `→ girou ${deltaDireita.toFixed(1)}° (esperava girar para a direita)`);

      const marcaEsquerda = await marcaDe(page);
      await seguraTecla(page, "ArrowLeft");
      const esquerda = (await estadoDe(page)).panoramas[0].pov.heading;
      const deltaEsquerda = ((esquerda - direita + 540) % 360) - 180;
      exige(deltaEsquerda < -5, `← girou ${deltaEsquerda.toFixed(1)}° (esperava girar para a esquerda)`);
      exige(
        (await novosRegistros(page, marcaEsquerda, "Panorama.setPov")).length > 3,
        "← não girou de forma contínua",
      );

      return `${antes.toFixed(1)}° →(+${deltaDireita.toFixed(1)}°) ${direita.toFixed(1)}° ←(${deltaEsquerda.toFixed(1)}°) ${esquerda.toFixed(1)}°, em ${povs.length} quadros`;
    });

    await verifica("↑/↓ inclinam e param nos limites", async () => {
      const antes = (await estadoDe(page)).panoramas[0].pov.pitch;
      await seguraTecla(page, "ArrowUp");
      const cima = (await estadoDe(page)).panoramas[0].pov.pitch;
      exige(cima > antes + 2, `↑ mudou o pitch de ${antes} para ${cima}`);

      await seguraTecla(page, "ArrowDown", 700);
      const baixo = (await estadoDe(page)).panoramas[0].pov.pitch;
      exige(baixo < cima - 2, `↓ mudou o pitch de ${cima} para ${baixo}`);

      // Segurando ↓ por muito tempo o pitch para no limite, sem embrulhar.
      await seguraTecla(page, "ArrowDown", 2000);
      const fundo = (await estadoDe(page)).panoramas[0].pov.pitch;
      exige(fundo >= -85.001, `pitch passou do limite: ${fundo}`);

      return `pitch ${antes.toFixed(1)}° → ${cima.toFixed(1)}° → ${baixo.toFixed(1)}° → travado em ${fundo.toFixed(1)}°`;
    });

    console.log("\n[2] W/S andam pelos links do Street View");
    await verifica("W anda para o link à frente e S para o de trás", async () => {
      // Volta ao ponto inicial para o heading ser conhecido, e planta dois
      // vizinhos: um na direção do olhar, outro atrás.
      await page.getByRole("button", { name: "Voltar ao ponto inicial" }).click();
      await page.waitForTimeout(200);
      const olhar = (await estadoDe(page)).panoramas[0].pov.heading;

      await page.evaluate(
        ({ frente, tras }) =>
          window.__dubleTeclado.defineLinks(0, [
            { heading: frente, pano: "duble-pano-frente" },
            { heading: tras, pano: "duble-pano-tras" },
          ]),
        { frente: (olhar + 10) % 360, tras: (olhar + 190) % 360 },
      );

      let marca = await marcaDe(page);
      await page.keyboard.press("KeyW");
      await page.waitForTimeout(150);
      let panos = await novosRegistros(page, marca, "Panorama.setPano");
      exige(panos.length === 1, `W chamou setPano ${panos.length} vezes`);
      exige(panos[0].dados?.pano === "duble-pano-frente", `W foi para ${panos[0].dados?.pano}`);

      // O olhar não gira quando o jogador anda.
      const depoisDeAndar = (await estadoDe(page)).panoramas[0].pov.heading;
      exige(
        Math.abs(depoisDeAndar - olhar) < 0.001,
        `andar mexeu no heading: ${olhar} → ${depoisDeAndar}`,
      );

      marca = await marcaDe(page);
      await page.keyboard.press("KeyS");
      await page.waitForTimeout(150);
      panos = await novosRegistros(page, marca, "Panorama.setPano");
      exige(panos.length === 1, `S chamou setPano ${panos.length} vezes`);
      exige(panos[0].dados?.pano === "duble-pano-tras", `S foi para ${panos[0].dados?.pano}`);

      return `W → duble-pano-frente e S → duble-pano-tras, heading firme em ${olhar.toFixed(1)}°`;
    });

    await verifica("sem link naquela direção, W não faz nada", async () => {
      const olhar = (await estadoDe(page)).panoramas[0].pov.heading;
      // Único vizinho a 90° do olhar: fora da tolerância, para frente e para trás.
      await page.evaluate(
        (lado) => window.__dubleTeclado.defineLinks(0, [{ heading: lado, pano: "duble-pano-de-lado" }]),
        (olhar + 90) % 360,
      );

      const marca = await marcaDe(page);
      await page.keyboard.press("KeyW");
      await page.keyboard.press("KeyS");
      await page.waitForTimeout(200);
      const panos = await novosRegistros(page, marca, "Panorama.setPano");
      exige(panos.length === 0, `andou sem link na direção: ${JSON.stringify(panos)}`);

      // E sem link nenhum também não anda.
      await page.evaluate(() => window.__dubleTeclado.defineLinks(0, []));
      const marcaVazia = await marcaDe(page);
      await page.keyboard.press("KeyW");
      await page.waitForTimeout(200);
      exige(
        (await novosRegistros(page, marcaVazia, "Panorama.setPano")).length === 0,
        "andou com a lista de links vazia",
      );

      return "link a 90° e lista vazia: 0 setPano";
    });

    console.log("\n[3] +/− dão zoom dentro dos limites");
    await verifica("+ aproxima, − afasta e nada sai de 0–4", async () => {
      const marca = await marcaDe(page);
      for (let i = 0; i < 6; i++) await page.keyboard.press("Equal");
      for (let i = 0; i < 9; i++) await page.keyboard.press("Minus");
      await page.waitForTimeout(200);

      const zooms = (await novosRegistros(page, marca, "Panorama.setZoom")).map(
        (r) => r.dados?.zoom as number,
      );
      exige(zooms.length === 15, `esperava 15 setZoom, vieram ${zooms.length}`);
      exige(zooms.every((z) => z >= 0 && z <= 4), `zoom fora dos limites: ${zooms.join(",")}`);
      exige(zooms.includes(4), "o + não chegou no limite de 4");
      exige(zooms.includes(0), "o − não chegou no limite de 0");

      return `6 vezes + e 9 vezes −: ${zooms.join(",")}`;
    });

    console.log("\n[4] R volta ao ponto inicial");
    await verifica("R restaura o pano e o ângulo do começo da rodada", async () => {
      const inicial = (await estadoDe(page)).registros.find((r) => r.tipo === "Panorama.setPov");
      const headingInicial = inicial?.dados?.heading as number;

      // Sai do lugar de todas as formas antes de voltar.
      await page.evaluate(
        (frente) => window.__dubleTeclado.defineLinks(0, [{ heading: frente, pano: "duble-pano-longe" }]),
        0,
      );
      await seguraTecla(page, "ArrowRight");
      await page.keyboard.press("KeyW");
      await page.waitForTimeout(150);

      const marca = await marcaDe(page);
      await page.keyboard.press("KeyR");
      await page.waitForTimeout(250);

      const panos = await novosRegistros(page, marca, "Panorama.setPano");
      const povs = await novosRegistros(page, marca, "Panorama.setPov");
      exige(panos.length === 1, `R chamou setPano ${panos.length} vezes`);
      exige(
        panos[0].dados?.pano === LOCAIS_FIXOS[0].panoId,
        `R voltou para o pano errado: ${panos[0].dados?.pano}`,
      );
      exige(povs.length === 1, `R chamou setPov ${povs.length} vezes`);
      exige(
        povs[0].dados?.heading === headingInicial && povs[0].dados?.pitch === 0,
        `R voltou com ângulo errado: ${JSON.stringify(povs[0].dados)}`,
      );

      return `setPano("${LOCAIS_FIXOS[0].panoId}") e setPov(${headingInicial.toFixed(1)}°, 0°)`;
    });

    console.log("\n[5] foco num campo de texto cala o teclado do panorama");
    await verifica("com o foco num <input>, nenhuma tecla chega no panorama", async () => {
      await page.evaluate(() => window.__dubleTeclado.campoDeTexto());
      exige(
        await page.evaluate(() => document.activeElement?.id === "campo-do-duble"),
        "o campo de texto não ficou com o foco",
      );

      await page.evaluate(
        (frente) => window.__dubleTeclado.defineLinks(0, [{ heading: frente, pano: "duble-pano-frente" }]),
        (await estadoDe(page)).panoramas[0].pov.heading,
      );

      const marca = await marcaDe(page);
      await seguraTecla(page, "ArrowRight");
      await seguraTecla(page, "ArrowUp");
      await page.keyboard.press("KeyW");
      await page.keyboard.press("KeyS");
      await page.keyboard.press("Equal");
      await page.keyboard.press("KeyR");
      await page.waitForTimeout(250);

      const estado = await estadoDe(page);
      const novos = estado.registros.slice(marca);
      exige(novos.length === 0, `o panorama reagiu com o foco no campo: ${JSON.stringify(novos)}`);

      // E o que foi digitado foi para o campo, não para o jogo.
      const digitado = await page.evaluate(
        () => (document.getElementById("campo-do-duble") as HTMLInputElement | null)?.value ?? "",
      );
      exige(/w/i.test(digitado), `o campo não recebeu as letras: "${digitado}"`);

      await page.evaluate(() => document.getElementById("campo-do-duble")?.remove());
      return `0 chamadas no panorama e o campo com "${digitado}"`;
    });

    console.log("\n[6] a lista de atalhos existe e é alcançável");
    await verifica('o botão "?" mostra e esconde os atalhos', async () => {
      const botao = page.getByRole("button", { name: "Atalhos do teclado" });
      await botao.waitFor({ timeout: 10_000 });

      const lista = page.getByRole("note", { name: "Atalhos do teclado" });
      // A dica automática da primeira rodada pode estar aberta: fecha antes.
      if (await lista.isVisible()) await botao.click();
      exige(!(await lista.isVisible()), "a lista continuou aberta depois de fechar");

      await botao.click();
      await lista.waitFor({ state: "visible", timeout: 5000 });
      const texto = (await lista.innerText()).replace(/\s+/g, " ").trim();
      for (const esperado of ["← →", "W S", "+ −", "R"]) {
        exige(texto.includes(esperado), `a lista não cita ${esperado}: "${texto}"`);
      }

      await botao.click();
      exige(!(await lista.isVisible()), "o segundo clique não fechou a lista");
      return `"${texto}"`;
    });

    exige(erros.length === 0, `exceções de página na sala liberada: ${erros.join(" | ")}`);
    await context.close();

    // ----------------------------------------------------- sala com as regras travadas
    console.log("\n[7] regras desligadas calam os atalhos correspondentes");
    await verifica("allowPan/allowMove/allowZoom em false: teclas não fazem nada", async () => {
      const ctx = await novoContexto(browser!, { width: 1440, height: 900 });
      const p = await ctx.newPage();
      const errosSala: string[] = [];
      p.on("pageerror", (err) => errosSala.push(`pageerror: ${err.message}`));

      try {
        await entraNoDesafio(p, desafioTravado, "tecladotravado");
        await p.evaluate(
          (frente) =>
            window.__dubleTeclado.defineLinks(0, [{ heading: frente, pano: "duble-pano-frente" }]),
          (await estadoDe(p)).panoramas[0].pov.heading,
        );

        const antes = (await estadoDe(p)).panoramas[0];
        const marca = await marcaDe(p);

        await seguraTecla(p, "ArrowRight");
        await seguraTecla(p, "ArrowLeft");
        await seguraTecla(p, "ArrowUp");
        await seguraTecla(p, "ArrowDown");
        await p.keyboard.press("KeyW");
        await p.keyboard.press("KeyS");
        await p.keyboard.press("Equal");
        await p.keyboard.press("Minus");
        await p.waitForTimeout(250);

        const estado = await estadoDe(p);
        const novos = estado.registros.slice(marca);
        exige(
          novos.length === 0,
          `com as regras travadas o panorama ainda reagiu: ${JSON.stringify(novos)}`,
        );
        exige(
          estado.panoramas[0].pov.heading === antes.pov.heading &&
            estado.panoramas[0].pov.pitch === antes.pov.pitch &&
            estado.panoramas[0].pano === antes.pano &&
            estado.panoramas[0].zoom === antes.zoom,
          "o panorama saiu do lugar com as regras travadas",
        );

        // R continua valendo: voltar ao início não depende de regra nenhuma.
        await p.keyboard.press("KeyR");
        await p.waitForTimeout(250);
        exige(
          (await novosRegistros(p, marca, "Panorama.setPano")).length === 1,
          "R deixou de funcionar na sala travada",
        );
        exige(errosSala.length === 0, errosSala.join(" | "));

        return `setas, W/S e +/− com 0 efeito; heading firme em ${antes.pov.heading.toFixed(1)}° e zoom ${antes.zoom}; R ainda volta`;
      } finally {
        await ctx.close().catch(() => {});
      }
    });

    // ------------------------------------------------------------ HUD medido
    for (const tela of [
      { nome: "desktop", arquivo: "desktop-1440x900.png", viewport: { width: 1440, height: 900 } },
      { nome: "celular", arquivo: "celular-390x844.png", viewport: { width: 390, height: 844 } },
    ]) {
      console.log(`\n[8] HUD em ${tela.viewport.width}×${tela.viewport.height}`);
      await verifica(`"Esperando" não cruza a bússola em ${tela.nome}`, async () => {
        const sala = await salaComEsperando(browser!, tela.viewport, tela.nome);
        try {
          const p = sala.anfitriao;

          const esperando = await caixaDoEsperando(p);
          const bussola = await caixaDe(p, 'button[aria-label="Olhar para o norte"]');
          // O botão de voltar ao início é o que existe em qualquer largura: o
          // "?" e a lista só aparecem a partir do `sm`.
          const controles = await caixaDe(p, 'button[aria-label="Voltar ao ponto inicial"]');
          const mapa = await caixaDe(p, 'div[data-duble="mapa-0"]');

          exige(
            !seCruzam(esperando, bussola),
            `"Esperando" (${escreveCaixa(esperando)}) cruza a bússola (${escreveCaixa(bussola)})`,
          );
          exige(
            !seCruzam(esperando, controles),
            `"Esperando" (${escreveCaixa(esperando)}) cruza os controles (${escreveCaixa(controles)})`,
          );
          exige(
            !seCruzam(esperando, mapa),
            `"Esperando" (${escreveCaixa(esperando)}) cruza o mini-mapa (${escreveCaixa(mapa)})`,
          );
          exige(
            !seCruzam(bussola, mapa),
            `a bússola (${escreveCaixa(bussola)}) cruza o mini-mapa (${escreveCaixa(mapa)})`,
          );

          // Na primeira rodada da aba a lista de atalhos abre sozinha: é o pior
          // caso do canto de baixo à esquerda, e também não pode cruzar nada.
          const lista = p.getByRole("note", { name: "Atalhos do teclado" });
          let sobreAtalhos = "lista de atalhos fechada";
          if (await lista.isVisible()) {
            const caixa = await caixaDe(p, 'div[aria-label="Atalhos do teclado"]');
            exige(
              !seCruzam(esperando, caixa),
              `a lista de atalhos (${escreveCaixa(caixa)}) cruza o "Esperando" (${escreveCaixa(esperando)})`,
            );
            exige(
              !seCruzam(bussola, caixa),
              `a lista de atalhos (${escreveCaixa(caixa)}) cobre a bússola (${escreveCaixa(bussola)})`,
            );
            exige(
              !seCruzam(mapa, caixa),
              `a lista de atalhos (${escreveCaixa(caixa)}) cruza o mini-mapa (${escreveCaixa(mapa)})`,
            );
            sobreAtalhos = `atalhos [${escreveCaixa(caixa)}]`;
          }

          /**
           * A bolha do chat da sala mora fora deste arquivo e fora desta issue.
           * O que se afirma aqui é o que dá para garantir daqui: ela não invade
           * a coluna do panorama. Se ela cruzar o HUD de cima (no celular ela é
           * uma faixa em `top-16`), o número sai no relatório para quem cuida do
           * chat decidir — mudar a faixa de lugar é do lado dele.
           */
          const bolha = p.getByRole("button", { name: /^Chat/ }).first();
          let sobreChat = "sem bolha de chat na tela";
          if (await bolha.isVisible()) {
            const caixa = await bolha.boundingBox();
            exige(caixa, "a bolha do chat sumiu no meio da medição");
            const chat = { x: caixa.x, y: caixa.y, width: caixa.width, height: caixa.height };
            exige(
              !seCruzam(chat, bussola) && !seCruzam(chat, controles),
              `a bolha do chat (${escreveCaixa(chat)}) cruza a coluna do panorama (bússola ${escreveCaixa(bussola)}, controles ${escreveCaixa(controles)})`,
            );
            sobreChat = `chat [${escreveCaixa(chat)}]${
              seCruzam(chat, esperando) ? ' — ATENÇÃO: cruza o "Esperando", ver ChatSala' : ""
            }`;
          }

          // O painel de espera é pendurado, não empilhado: a linha de cima
          // continua com o contador inteiro dentro da tela.
          const contador = await caixaDe(
            p,
            'div.panel:has(p:text-is("Palpitaram")), div.panel:has(p:text-is("Duelo"))',
          );
          exige(
            contador.x + contador.width <= tela.viewport.width,
            `o contador vazou da tela: ${escreveCaixa(contador)} numa tela de ${tela.viewport.width}px`,
          );
          exige(
            !seCruzam(contador, esperando),
            `o contador (${escreveCaixa(contador)}) cruza o "Esperando" (${escreveCaixa(esperando)})`,
          );

          // Nada pode estar empurrando a página para os lados nem para fora.
          const transbordo = await p.evaluate(() => ({
            largura: document.documentElement.scrollWidth - window.innerWidth,
            dentro: window.innerHeight,
          }));
          exige(transbordo.largura <= 0, `a tela ganhou ${transbordo.largura}px de rolagem lateral`);
          exige(
            esperando.y >= 0 && esperando.y + esperando.height <= transbordo.dentro,
            `"Esperando" saiu da tela: ${escreveCaixa(esperando)}`,
          );

          await p.screenshot({ path: join(PASTA_CAPTURAS, tela.arquivo) });
          exige(sala.erros.length === 0, sala.erros.join(" | "));

          return `Esperando [${escreveCaixa(esperando)}] · bússola [${escreveCaixa(bussola)}] · controles [${escreveCaixa(controles)}] · mini-mapa [${escreveCaixa(mapa)}] · ${sobreAtalhos} · ${sobreChat} → captura design/hud/${tela.arquivo}`;
        } finally {
          for (const ctx of sala.contextos) await ctx.close().catch(() => {});
        }
      });
    }

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
  console.error("erro fatal no teste de teclado:", err);
  process.exit(1);
});
