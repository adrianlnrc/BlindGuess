/**
 * Teste de navegador das telas do jogo.
 *
 * Sobe o servidor de verdade (Next + socket.io), abre as telas num Chromium e
 * confere que elas montam, que as fontes chegaram e que a tela de jogo se
 * segura mesmo sem a API do Google Maps — que aqui nunca carrega.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-navegador.ts
 *
 * O Chromium precisa estar instalado (PLAYWRIGHT_BROWSERS_PATH ou o caminho
 * padrao do Playwright). Se o binario nao casar com a versao do pacote, aponte
 * CHROMIUM_PATH para o executavel.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import { getPool, migrate } from "@/server/db";
import { createChallenge } from "@/server/store";
import { DEFAULT_AVATAR, type RoomSettings } from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const APELIDO = "testenavegador";

/** Rotas que precisam abrir sem exceção de página. */
const ROTAS = ["/", "/entrar", "/ranking", "/loja", "/amigos", "/desafio/qualquer", "/room/ABC12"];

/**
 * Ruído esperado: sem chave do Google nada de maps carrega, e o socket pode
 * reclamar de transporte. Nada disso é exceção de página.
 */
const RUIDO_ESPERADO = [
  "maps.googleapis.com",
  "failed to load resource",
  "net::err_",
  "err_blocked_by_client",
  "google_maps_api_key",
  "websocket",
  "favicon",
];

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

function sobeServidor(): ChildProcess {
  const server = spawn("node_modules/.bin/tsx", ["server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "teste",
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

// -------------------------------------------------------------------- página

type Vigia = { erros: string[] };

/** Liga a captura de exceções de página e de erros de console relevantes. */
function vigia(page: Page): Vigia {
  const erros: string[] = [];

  page.on("pageerror", (err) => erros.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const texto = msg.text();
    const baixo = texto.toLowerCase();
    if (RUIDO_ESPERADO.some((r) => baixo.includes(r))) return;
    erros.push(`console: ${texto}`);
  });

  return { erros };
}

/** Deixa o perfil pronto no localStorage, com apelido, antes de navegar. */
async function preparaPerfil(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const apelido = page.locator("#nickname");
  await apelido.waitFor({ state: "visible", timeout: 20_000 });
  await apelido.fill(APELIDO);
  await page.waitForFunction(
    (nome) => (window.localStorage.getItem("blindguess:profile") ?? "").includes(nome),
    APELIDO,
    { timeout: 10_000 },
  );
}

// ------------------------------------------------------------------ desafio

const LOCAIS_FIXOS = [
  { lat: -23.5505, lng: -46.6333, panoId: "teste-pano-sao-paulo" },
  { lat: 48.8566, lng: 2.3522, panoId: "teste-pano-paris" },
];

const CONFIG_DESAFIO: RoomSettings = {
  rounds: LOCAIS_FIXOS.length,
  roundSeconds: 120,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

/** Semeia um desafio com locais fixos, para chegar na tela de jogo sem o Google. */
async function semeiaDesafio(): Promise<string> {
  await migrate();
  return createChallenge({
    creator: {
      id: "teste-navegador-autor",
      name: "Teste de navegador",
      avatar: { ...DEFAULT_AVATAR },
    },
    settings: CONFIG_DESAFIO,
    locations: LOCAIS_FIXOS,
  });
}

// ----------------------------------------------------------------- execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;

  console.log("> subindo o servidor…");
  const server = sobeServidor();
  let browser: Browser | null = null;

  try {
    await esperaServidor();
    console.log(`> servidor no ar em ${BASE}`);

    const codigoDesafio = await semeiaDesafio();
    console.log(`> desafio semeado: ${codigoDesafio}`);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

    console.log("\n[1] rotas montam sem exceção de página");
    for (const rota of ROTAS) {
      await verifica(`rota ${rota}`, async () => {
        const context = await browser!.newContext();
        const page = await context.newPage();
        const { erros } = vigia(page);
        const res = await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });

        exige(res, `sem resposta para ${rota}`);
        exige(res.status() < 400, `HTTP ${res.status()}`);

        // Espera a hidratação e os efeitos do cliente rodarem.
        await page.waitForTimeout(2500);

        const texto = (await page.locator("body").innerText()).trim();
        exige(texto.length > 0, "a página montou vazia (tela branca)");
        exige(erros.length === 0, erros.join(" | "));

        await context.close();
        return `HTTP ${res.status()}, ${texto.length} caracteres visíveis`;
      });
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const vigilancia = vigia(page);

    console.log("\n[2] a home renderiza o essencial");
    await verifica("home: título, apelido, modos, desafio do dia e rodapé", async () => {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.locator("h1", { hasText: "BlindGuess" }).waitFor({ timeout: 20_000 });
      await page.locator("#nickname").waitFor({ timeout: 10_000 });

      const modos = ["Jogar solo", "Duelo 1v1", "Sala com amigos", "Desafio por link"];
      for (const modo of modos) {
        const cartao = page.locator("section", { hasText: modo });
        exige(await cartao.count() > 0, `cartão de modo ausente: ${modo}`);
      }

      await page.getByRole("heading", { name: "Desafio do dia" }).waitFor({ timeout: 10_000 });

      for (const link of ["Amigos", "Loja", "Ranking e streaks →"]) {
        exige(
          (await page.locator("footer").getByRole("link", { name: link }).count()) > 0,
          `link do rodapé ausente: ${link}`,
        );
      }

      exige(vigilancia.erros.length === 0, vigilancia.erros.join(" | "));
      return `${modos.length} cartões de modo, card do dia e rodapé presentes`;
    });

    console.log("\n[3] editor de avatar");
    await verifica("editor de avatar abre e desenha o personagem", async () => {
      await page.getByRole("button", { name: "Personalizar" }).click();
      const editor = page.locator("text=seu personagem");
      await editor.waitFor({ timeout: 10_000 });

      const svgs = page.locator("svg");
      exige((await svgs.count()) > 0, "nenhum SVG do personagem no editor");

      const caixa = await page.locator("svg").first().boundingBox();
      exige(caixa && caixa.width > 10 && caixa.height > 10, "o SVG do personagem não tem tamanho");

      exige(vigilancia.erros.length === 0, vigilancia.erros.join(" | "));
      return `editor aberto com ${await svgs.count()} SVGs`;
    });

    console.log("\n[4] fontes novas aplicadas");
    await verifica("título usa a família de display (Outfit)", async () => {
      await page.evaluate(() => document.fonts.ready);

      const familia = await page
        .locator("h1")
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily);
      exige(
        /outfit/i.test(familia),
        `o título caiu no fallback do sistema: font-family = ${familia}`,
      );

      const carregada = await page.evaluate(() =>
        Array.from(document.fonts).some(
          (f) => /outfit/i.test(f.family) && f.status === "loaded",
        ),
      );
      exige(carregada, "a face Outfit não foi carregada pelo navegador");

      const familiaCorpo = await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily);
      exige(
        /jakarta/i.test(familiaCorpo),
        `o corpo caiu no fallback do sistema: font-family = ${familiaCorpo}`,
      );

      return `h1 = ${familia}; body = ${familiaCorpo}`;
    });

    console.log("\n[5] tela de jogo sem a API do Google");
    await verifica("sala do desafio chega em 'playing' com HUD e erro do panorama", async () => {
      await preparaPerfil(page);

      await page.goto(`${BASE}/desafio/${codigoDesafio}`, { waitUntil: "domcontentloaded" });
      const aceitar = page.getByRole("button", { name: /Aceitar o desafio|Jogar de novo/ });
      await aceitar.waitFor({ timeout: 20_000 });
      await aceitar.click();

      await page.waitForURL(/\/room\/[A-Z0-9]+$/, { timeout: 20_000 });

      const comecar = page.getByRole("button", { name: "Jogar o desafio" });
      await comecar.waitFor({ timeout: 20_000 });
      await comecar.click();

      // HUD da partida
      await page.locator("text=Rodada").first().waitFor({ timeout: 20_000 });
      await page.locator("text=Tempo").first().waitFor({ timeout: 10_000 });

      // A falha do Street View tem que virar mensagem, não tela branca.
      const aviso = page.locator("text=Não deu para carregar o panorama");
      await aviso.waitFor({ timeout: 20_000 });
      const motivo = (await page.locator("text=NEXT_PUBLIC_GOOGLE_MAPS_API_KEY").count()) > 0;
      exige(motivo, "a mensagem de erro não diz o motivo (chave do Maps ausente)");

      // O mini-mapa também não carrega sem a chave: tem que avisar, não sumir.
      await page.locator("text=Não deu para carregar o mapa").waitFor({ timeout: 20_000 });

      // O HUD chega em caixa alta pelo CSS; comparamos sem diferenciar caixa.
      const texto = (await page.locator("body").innerText()).toLowerCase();
      exige(texto.includes("rodada"), "HUD sumiu depois da falha do panorama");
      exige(texto.includes("tempo"), "o cronômetro sumiu depois da falha do panorama");
      exige(vigilancia.erros.length === 0, vigilancia.erros.join(" | "));

      return "HUD visível e mensagens de erro do panorama e do mapa no lugar da tela branca";
    });

    await context.close();

    console.log("\n[6] viewport de celular (390px)");
    await verifica("home não rola na horizontal nem vaza elementos", async () => {
      const mobile = await browser!.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const p = await mobile.newPage();
      const { erros } = vigia(p);

      await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await p.locator("#nickname").waitFor({ timeout: 20_000 });
      await p.waitForTimeout(1500);

      const medidas = await p.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        cliente: document.documentElement.clientWidth,
        largura: window.innerWidth,
      }));
      exige(
        medidas.scroll <= medidas.cliente + 1,
        `rolagem horizontal: scrollWidth ${medidas.scroll} > clientWidth ${medidas.cliente}`,
      );

      const vazando = await p.evaluate(() => {
        const fora: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > window.innerWidth + 1 || r.left < -1) {
            fora.push(
              `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} (${Math.round(r.left)}→${Math.round(r.right)})`,
            );
          }
        }
        return fora.slice(0, 5);
      });
      exige(vazando.length === 0, `elementos fora da tela: ${vazando.join(" | ")}`);
      exige(erros.length === 0, erros.join(" | "));

      await mobile.close();
      return `scrollWidth ${medidas.scroll} = clientWidth ${medidas.cliente}, nenhum elemento vazando`;
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
  console.error("erro fatal no teste de navegador:", err);
  process.exit(1);
});
