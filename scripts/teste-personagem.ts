/**
 * Verificação do personagem 3D (`src/components/three/`).
 *
 * Não depende do servidor do jogo: empacota um harness com o esbuild que já
 * vem com o tsx, serve numa porta local e dirige um Chromium. Assim o teste
 * não precisa de banco, de chave do Maps nem de rota nova no app.
 *
 * O que ele confere:
 *   1. o canvas ganha contexto WebGL e desenha pixels de verdade;
 *   2. os nove chapéus e os sete rostos montam sem erro e mudam a imagem;
 *   3. trocar de cosmético não cria contexto WebGL novo (nada de vazamento),
 *      e desmontar a cena devolve o contexto;
 *   4. sem WebGL, o componente cai no bonequinho SVG.
 *
 * De brinde salva as capturas de `design/personagem-3d/`.
 *
 * Rodar:
 *   npx tsx scripts/teste-personagem.ts
 *
 * Chromium: /opt/pw-browsers/chromium (ou CHROMIUM_PATH). WebGL em headless sai
 * pelo SwiftShader, por isso as flags de ANGLE.
 */

import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import * as esbuild from "esbuild";
import { DEFAULT_AVATAR, type Avatar, type FaceId, type HatId } from "@/lib/types";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = Number(process.env.PORTA_TESTE ?? 3411);
const BASE = `http://127.0.0.1:${PORTA}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const PASTA_CAPTURAS = path.join(RAIZ, "design", "personagem-3d");

const CHAPEUS: HatId[] = [
  "none",
  "cap",
  "explorer",
  "beanie",
  "headphones",
  "bucket",
  "visor",
  "helmet",
  "crown",
];

const ROSTOS: FaceId[] = ["smile", "focused", "glasses", "shades", "wink", "grin", "eyepatch"];

const ROTULO_CHAPEU: Record<HatId, string> = {
  none: "sem chapéu",
  cap: "boné",
  explorer: "explorador",
  beanie: "gorro",
  headphones: "fone",
  bucket: "bucket",
  visor: "viseira",
  helmet: "capacete",
  crown: "coroa",
};

const ROTULO_ROSTO: Record<FaceId, string> = {
  smile: "sorriso",
  focused: "focado",
  glasses: "óculos",
  shades: "escuros",
  wink: "piscadinha",
  grin: "sorrisão",
  eyepatch: "tapa-olho",
};

/** Três combinações de cor para as capturas, dentro da paleta do jogo. */
const COMBINACOES: { rotulo: string; avatar: Avatar }[] = [
  {
    rotulo: "padrão — pele média, roupa beam, detalhe flare",
    avatar: { ...DEFAULT_AVATAR },
  },
  {
    rotulo: "pele clara, roupa violeta, coroa dourada, óculos escuros",
    avatar: { skin: "#f1c7a4", outfit: "#3c2e6b", accent: "#ffb454", hat: "crown", face: "shades" },
  },
  {
    rotulo: "pele escura, roupa rosa, fone, sorrisão",
    avatar: { skin: "#6c4430", outfit: "#ff5f8d", accent: "#3ce7ad", hat: "headphones", face: "grin" },
  },
  {
    rotulo: "pele oliva, roupa beam escura, explorador, focado",
    avatar: { skin: "#a9764a", outfit: "#16c491", accent: "#ece9f6", hat: "explorer", face: "focused" },
  },
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

// ------------------------------------------------------------------- harness

/** Página do harness: fundo do jogo e um ponto de montagem. */
const HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Personagem 3D — verificação</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #110b20;
        color: #ece9f6;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      #raiz { padding: 16px; }
      .grade { display: grid; gap: 12px; justify-content: start; }
      .celula {
        background: linear-gradient(180deg, #1c1436 0%, #110b20 100%);
        border: 1px solid #3c2e6b;
        border-radius: 14px;
        overflow: hidden;
      }
      .rotulo {
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #a79cc0;
        padding: 6px 10px 10px;
        text-align: center;
      }
      .titulo { font-size: 15px; margin: 4px 0 14px; color: #ece9f6; }
    </style>
  </head>
  <body>
    <div id="raiz"></div>
    <script src="/app.js"></script>
  </body>
</html>`;

/** Entrada do bundle: monta o personagem sob controle do Playwright. */
const ENTRADA = `
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PersonagemCanvas from "@/components/three/PersonagemCanvas";
import Personagem3D from "@/components/three/Personagem3D";

const janela = window;

function Celula({ item, largura, altura }) {
  const Comp = item.modo === "auto" ? Personagem3D : PersonagemCanvas;
  return (
    <div className="celula" style={{ width: largura }}>
      <div style={{ width: largura, height: altura }}>
        <Comp avatar={item.avatar} className="cena" animar={item.animar} rotationY={item.rotationY} />
      </div>
      {item.rotulo ? <div className="rotulo">{item.rotulo}</div> : null}
    </div>
  );
}

function App() {
  const [estado, setEstado] = useState({ tipo: "vazio" });
  janela.__definirEstado = setEstado;

  useEffect(() => {
    janela.__pronto = true;
  }, []);

  if (estado.tipo === "vazio") return <div id="vazio">nada montado</div>;

  const colunas = estado.colunas ?? 3;
  return (
    <div>
      {estado.titulo ? <div className="titulo">{estado.titulo}</div> : null}
      <div
        className="grade"
        id="grade"
        style={{ gridTemplateColumns: \`repeat(\${colunas}, \${estado.largura}px)\` }}
      >
        {estado.itens.map((item, i) => (
          <Celula key={item.chave ?? i} item={item} largura={estado.largura} altura={estado.altura} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("raiz")).render(<App />);

janela.__personagem = {
  monta(config) {
    janela.__definirEstado({ tipo: "grade", ...config });
  },
  desmonta() {
    janela.__definirEstado({ tipo: "vazio" });
  },
};
`;

/** Instrumentação do WebGL: conta contextos e chamadas de desenho. */
const INSTRUMENTACAO = `(() => {
  const janela = window;
  janela.__metricas = { contextos: 0, desenhos: 0, erros: [] };
  const original = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (tipo, atributos) {
    const ehWebGL = tipo === "webgl" || tipo === "webgl2" || tipo === "experimental-webgl";
    if (ehWebGL && janela.__semWebGL) return null;
    if (!ehWebGL) return original.call(this, tipo, atributos);
    // preserveDrawingBuffer deixa o teste ler os pixels depois do quadro.
    const contexto = original.call(this, tipo, { ...(atributos || {}), preserveDrawingBuffer: true });
    if (contexto) janela.__metricas.contextos += 1;
    return contexto;
  };

  for (const classe of [janela.WebGLRenderingContext, janela.WebGL2RenderingContext]) {
    if (!classe) continue;
    for (const nome of ["drawElements", "drawArrays", "drawElementsInstanced"]) {
      const fn = classe.prototype[nome];
      if (!fn) continue;
      classe.prototype[nome] = function (...args) {
        janela.__metricas.desenhos += 1;
        return fn.apply(this, args);
      };
    }
  }

  janela.addEventListener("error", (e) => janela.__metricas.erros.push(String(e.message)));
})();`;

async function empacota(): Promise<string> {
  const pasta = await mkdtemp(path.join(tmpdir(), "personagem-3d-"));
  const entrada = path.join(pasta, "entrada.jsx");
  await writeFile(entrada, ENTRADA, "utf8");

  const saida = await esbuild.build({
    entryPoints: [entrada],
    bundle: true,
    write: false,
    format: "iife",
    target: "chrome110",
    jsx: "automatic",
    loader: { ".jsx": "jsx" },
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": path.join(RAIZ, "src") },
    nodePaths: [path.join(RAIZ, "node_modules")],
    absWorkingDir: RAIZ,
    logLevel: "error",
  });

  const arquivo = saida.outputFiles?.[0];
  if (!arquivo) throw new Error("o esbuild não devolveu o bundle");
  return arquivo.text;
}

function sobeServidor(bundle: string): Server {
  const servidor = createServer((req, res) => {
    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundle);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  servidor.listen(PORTA, "127.0.0.1");
  return servidor;
}

// -------------------------------------------------------------------- página

type Item = {
  avatar: Avatar;
  rotulo?: string;
  chave?: string;
  modo?: "auto" | "cena";
  animar?: boolean;
  rotationY?: number;
};

type Config = {
  itens: Item[];
  largura: number;
  altura: number;
  colunas?: number;
  titulo?: string;
};

type Metricas = { contextos: number; desenhos: number; erros: string[] };

async function abre(browser: Browser, semWebGL = false) {
  const contexto = await browser.newContext({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
  const erros: string[] = [];
  const page = await contexto.newPage();
  page.on("pageerror", (err) => erros.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(`console: ${msg.text()}`);
  });

  if (semWebGL) await page.addInitScript("window.__semWebGL = true;");
  await page.addInitScript(INSTRUMENTACAO);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { __pronto?: boolean }).__pronto === true, {
    timeout: 30_000,
  });
  return { page, erros, contexto };
}

async function monta(page: Page, config: Config): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __personagem: { monta(c: unknown): void } }).__personagem.monta(c);
  }, config as unknown as Record<string, unknown>);
  await page.waitForTimeout(700);
}

async function metricas(page: Page): Promise<Metricas> {
  return page.evaluate(() => (window as unknown as { __metricas: Metricas }).__metricas);
}

/**
 * Lê o canvas: quantos pixels visíveis e uma assinatura simples da imagem,
 * para comparar cosméticos diferentes.
 */
async function leCanvas(page: Page, indice = 0) {
  return page.evaluate((i) => {
    const canvas = document.querySelectorAll("canvas")[i] as HTMLCanvasElement | undefined;
    if (!canvas) return null;
    const copia = document.createElement("canvas");
    copia.width = canvas.width;
    copia.height = canvas.height;
    const ctx = copia.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const dados = ctx.getImageData(0, 0, copia.width, copia.height).data;

    let visiveis = 0;
    let assinatura = 0;
    for (let p = 0; p < dados.length; p += 4) {
      if (dados[p + 3] > 16) {
        visiveis += 1;
        assinatura = (assinatura + (p / 4) * (dados[p] + dados[p + 1] * 3 + dados[p + 2] * 7)) % 2147483647;
      }
    }
    return { largura: canvas.width, altura: canvas.height, visiveis, assinatura };
  }, indice);
}

// ----------------------------------------------------------------- execução

async function main(): Promise<void> {
  console.log("> empacotando o harness com o esbuild…");
  const bundle = await empacota();
  const servidor = sobeServidor(bundle);
  await mkdir(PASTA_CAPTURAS, { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    });
    console.log(`> harness no ar em ${BASE}`);

    const { page, erros } = await abre(browser);

    console.log("\n[1] o canvas ganha contexto e desenha");
    await verifica("cena monta, cria 1 contexto WebGL e desenha pixels", async () => {
      await monta(page, {
        itens: [{ avatar: { ...DEFAULT_AVATAR }, chave: "solo" }],
        largura: 420,
        altura: 480,
      });
      const m = await metricas(page);
      exige(m.contextos >= 1, "nenhum contexto WebGL foi criado (headless sem GPU?)");
      exige(m.desenhos > 0, "o renderizador não fez nenhuma chamada de desenho");

      const leitura = await leCanvas(page);
      exige(leitura, "canvas não encontrado");
      exige(leitura.largura > 0 && leitura.altura > 0, "canvas com buffer de tamanho zero");
      const proporcao = leitura.visiveis / (leitura.largura * leitura.altura);
      exige(proporcao > 0.03, `quase nada desenhado: ${(proporcao * 100).toFixed(2)}% de pixels visíveis`);
      exige(erros.length === 0, erros.join(" | "));
      return `${leitura.largura}x${leitura.altura}, ${(proporcao * 100).toFixed(1)}% de pixels do personagem, ${m.desenhos} draws`;
    });

    console.log("\n[2] os nove chapéus montam e mudam a imagem");
    await verifica("9 chapéus, cada um com silhueta própria", async () => {
      const antes = (await metricas(page)).contextos;
      const assinaturas = new Map<string, number>();

      for (const hat of CHAPEUS) {
        await monta(page, {
          itens: [{ avatar: { ...DEFAULT_AVATAR, hat }, chave: "solo" }],
          largura: 420,
          altura: 480,
        });
        const leitura = await leCanvas(page);
        exige(leitura && leitura.visiveis > 0, `chapéu ${hat} não desenhou nada`);
        assinaturas.set(hat, leitura.assinatura);
        exige(erros.length === 0, `chapéu ${hat}: ${erros.join(" | ")}`);
      }

      const distintas = new Set(assinaturas.values());
      exige(
        distintas.size === CHAPEUS.length,
        `chapéus com imagem idêntica: ${distintas.size} imagens para ${CHAPEUS.length} chapéus`,
      );

      const depois = (await metricas(page)).contextos;
      exige(
        depois === antes,
        `trocar de chapéu criou ${depois - antes} contexto(s) WebGL — houve remonte do canvas`,
      );
      return `${CHAPEUS.length} chapéus distintos, 0 contexto novo`;
    });

    console.log("\n[3] os sete rostos montam e mudam a imagem");
    await verifica("7 rostos, cada um com expressão própria", async () => {
      const antes = (await metricas(page)).contextos;
      const assinaturas = new Map<string, number>();

      for (const face of ROSTOS) {
        await monta(page, {
          itens: [{ avatar: { ...DEFAULT_AVATAR, hat: "none", face }, chave: "solo" }],
          largura: 420,
          altura: 480,
        });
        const leitura = await leCanvas(page);
        exige(leitura && leitura.visiveis > 0, `rosto ${face} não desenhou nada`);
        assinaturas.set(face, leitura.assinatura);
        exige(erros.length === 0, `rosto ${face}: ${erros.join(" | ")}`);
      }

      const distintas = new Set(assinaturas.values());
      exige(
        distintas.size === ROSTOS.length,
        `rostos com imagem idêntica: ${distintas.size} imagens para ${ROSTOS.length} rostos`,
      );

      const depois = (await metricas(page)).contextos;
      exige(depois === antes, `trocar de rosto criou ${depois - antes} contexto(s) WebGL`);
      return `${ROSTOS.length} rostos distintos, 0 contexto novo`;
    });

    console.log("\n[4] desmontar devolve o contexto WebGL");
    await verifica("desmonte perde o contexto e remonte cria só um", async () => {
      const antes = (await metricas(page)).contextos;
      await page.evaluate(() => {
        (window as unknown as { __personagem: { desmonta(): void } }).__personagem.desmonta();
      });
      await page.waitForTimeout(600);

      const canvasRestantes = await page.locator("canvas").count();
      exige(canvasRestantes === 0, `${canvasRestantes} canvas continuaram no DOM depois do desmonte`);

      await monta(page, {
        itens: [{ avatar: { ...DEFAULT_AVATAR }, chave: "solo" }],
        largura: 420,
        altura: 480,
      });
      const depois = (await metricas(page)).contextos;
      exige(
        depois - antes <= 1,
        `remontar criou ${depois - antes} contextos — algo ficou preso no anterior`,
      );
      exige(erros.length === 0, erros.join(" | "));
      return `canvas removido do DOM, +${depois - antes} contexto no remonte`;
    });

    console.log("\n[5] reserva em SVG quando não há WebGL");
    await verifica("sem contexto WebGL o componente mostra o bonequinho SVG", async () => {
      const semGL = await abre(browser!, true);
      await monta(semGL.page, {
        itens: [{ avatar: { ...DEFAULT_AVATAR }, chave: "solo", modo: "auto" }],
        largura: 420,
        altura: 480,
      });
      await semGL.page.waitForTimeout(500);

      const canvas = await semGL.page.locator("canvas").count();
      exige(canvas === 0, `apareceu canvas (${canvas}) mesmo sem WebGL`);
      const reserva = await semGL.page.locator('[data-personagem="svg"] svg').count();
      exige(reserva > 0, "o bonequinho SVG de reserva não apareceu");

      const m = await metricas(semGL.page);
      exige(m.desenhos === 0, "houve desenho WebGL num navegador sem WebGL");
      await semGL.contexto.close();
      return `nenhum canvas, ${reserva} SVG de reserva no lugar`;
    });

    console.log("\n[6] com WebGL o caminho público usa o canvas 3D");
    await verifica("Personagem3D carrega a cena quando há WebGL", async () => {
      const comGL = await abre(browser!);
      await monta(comGL.page, {
        itens: [{ avatar: { ...DEFAULT_AVATAR }, chave: "solo", modo: "auto" }],
        largura: 420,
        altura: 480,
      });
      await comGL.page.waitForTimeout(900);
      const canvas = await comGL.page.locator("canvas").count();
      exige(canvas === 1, `esperava 1 canvas do caminho público, achei ${canvas}`);
      exige(comGL.erros.length === 0, comGL.erros.join(" | "));
      await comGL.contexto.close();
      return "next/dynamic trouxe a cena e o canvas montou";
    });

    console.log("\n[7] capturas de tela");
    await verifica("capturas dos chapéus, dos rostos e das combinações", async () => {
      const arquivos: string[] = [];

      const grade = async (
        nome: string,
        config: Config,
      ): Promise<void> => {
        await monta(page, config);
        await page.waitForTimeout(1200);
        const destino = path.join(PASTA_CAPTURAS, nome);
        await page.locator("#raiz").screenshot({ path: destino });
        arquivos.push(nome);
      };

      await grade("combinacoes.png", {
        titulo: "BlindGuess — personagem 3D: combinações de cor, chapéu e rosto",
        itens: COMBINACOES.map((c, i) => ({
          avatar: c.avatar,
          rotulo: c.rotulo,
          chave: `combo-${i}`,
          animar: false,
        })),
        largura: 265,
        altura: 330,
        colunas: 4,
      });

      await grade("chapeus.png", {
        titulo: "Os nove chapéus da loja em 3D",
        itens: CHAPEUS.map((hat) => ({
          avatar: { ...DEFAULT_AVATAR, hat, face: "smile" },
          rotulo: ROTULO_CHAPEU[hat],
          chave: `hat-${hat}`,
          animar: false,
        })),
        largura: 250,
        altura: 300,
        colunas: 3,
      });

      await grade("rostos.png", {
        titulo: "Os sete rostos da loja em 3D",
        itens: ROSTOS.map((face) => ({
          avatar: { ...DEFAULT_AVATAR, hat: "none", face },
          rotulo: ROTULO_ROSTO[face],
          chave: `face-${face}`,
          animar: false,
        })),
        largura: 250,
        altura: 300,
        colunas: 4,
      });

      // Retrato grande, para avaliar o acabamento de perto.
      await grade("retrato.png", {
        titulo: "Retrato — pele, roupa, boné e sorriso padrão",
        itens: [
          { avatar: { ...DEFAULT_AVATAR }, chave: "retrato-frente", rotulo: "de frente", animar: false },
          {
            avatar: { ...DEFAULT_AVATAR },
            chave: "retrato-tres-quartos",
            rotulo: "três quartos",
            animar: false,
            rotationY: 0.6,
          },
        ],
        largura: 470,
        altura: 560,
        colunas: 2,
      });

      return arquivos.join(", ");
    });
  } finally {
    await browser?.close().catch(() => {});
    servidor.close();
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  for (const f of falhas) console.log(`  FALHA ${f.nome} — ${f.detalhe}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro fatal na verificação do personagem:", err);
  process.exit(1);
});
