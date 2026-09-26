/**
 * Capturas de tela do modo sequência de países, para `design/streak/`.
 *
 * Não usa `server.ts`: sobe o Next com um socket.io mínimo (só os eventos que a
 * sequência precisa) e um `RoomManager` com o sorteio de local e a descoberta de
 * país injetados. Assim as telas são as de verdade — mesmo servidor de estado,
 * mesmos componentes — sem depender da API do Google nem gastar cota.
 *
 * O Street View e os mapas não carregam (não há chave neste ambiente): o que as
 * capturas mostram é o HUD, os números e o veredicto, que é o que a issue #17
 * pede para olhar. O aviso de mapa que falta faz parte da tela e fica visível.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/capturas-sequencia.ts
 */

import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import next from "next";
import { chromium, type Browser, type Page } from "playwright";
import { Server as SocketServer } from "socket.io";
import { RoomManager } from "@/server/rooms";
import { DEFAULT_AVATAR, type ClientToServerEvents, type LatLng, type PlayerProfile, type ServerToClientEvents } from "@/lib/types";
import type { PickedLocation } from "@/server/locations";
import type { Pais } from "@/server/paises";

const PORT = Number(process.env.PORT_CAPTURAS ?? 3480);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const DESTINO = new URL("../design/streak/", import.meta.url).pathname;

/** Onde o jogador "cai": todas as rodadas em Portugal, para o roteiro ser previsível. */
const ALVO: LatLng = { lat: 38.72, lng: -9.13 };
const PALPITE_CERTO: LatLng = { lat: 39.5, lng: -8.2 };
const PALPITE_ERRADO: LatLng = { lat: 40.41, lng: -3.7 };

const PERFIL: PlayerProfile = {
  id: "capturas-sequencia",
  name: "capturas",
  avatar: { ...DEFAULT_AVATAR },
};

function paisDoPonto(p: LatLng): Pais | null {
  if (p.lng < -30) return null;
  if (p.lng < -6) return { code: "PT", name: "Portugal" };
  return { code: "ES", name: "Espanha" };
}

let sorteios = 0;
async function sorteiaLocal(): Promise<PickedLocation | null> {
  sorteios += 1;
  return { ...ALVO, panoId: `capturas-pano-${sorteios}` };
}

// ------------------------------------------------------------------ servidor

const app = next({ dev: false, hostname: "127.0.0.1", port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

const httpServer = createServer((req, res) => {
  handle(req, res).catch(() => {
    res.statusCode = 500;
    res.end("erro");
  });
});

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  path: "/api/socket",
});

const rooms = new RoomManager(
  (code) => {
    const state = rooms.getState(code);
    if (state) io.to(code).emit("state", state);
  },
  { pickLocation: sorteiaLocal, paisDe: async (ponto) => paisDoPonto(ponto) },
);

/** A sala é criada aqui, antes do navegador abrir: a tela só entra nela. */
const sala = rooms.createStreakRoom(PERFIL, "sem-socket");

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ code, profile, playerId }, ack) => {
    const res = rooms.joinRoom(code.toUpperCase(), profile, socket.id, playerId);
    if (!res.ok) return ack(res);
    socket.join(code.toUpperCase());
    ack({ ok: true, code: code.toUpperCase(), playerId: res.playerId });
    const state = rooms.getState(code.toUpperCase());
    if (state) socket.emit("state", state);
  });
});

await new Promise<void>((resolve) => httpServer.listen(PORT, "127.0.0.1", resolve));
console.log(`> servidor de capturas em ${BASE}, sala ${sala.code}`);

// ------------------------------------------------------------------ navegador

/** Deixa perfil e assento prontos no localStorage antes da primeira navegação. */
async function preparaAba(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ perfil, code, playerId }) => {
      window.localStorage.setItem("blindguess:profile", JSON.stringify(perfil));
      window.localStorage.setItem(`blindguess:playerId:${code}`, playerId);
    },
    { perfil: PERFIL, code: sala.code, playerId: sala.playerId },
  );
}

async function captura(page: Page, nome: string): Promise<void> {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DESTINO}${nome}.png` });
  console.log(`  ${nome}.png`);
}

/** Palpita pelo servidor e espera o veredicto: o clique real depende do mapa. */
async function palpita(position: LatLng): Promise<void> {
  rooms.submitGuess(sala.code, sala.playerId, position);
  for (let i = 0; i < 200; i++) {
    if (rooms.getState(sala.code)?.phase !== "playing") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("o palpite não produziu veredicto");
}

const TELAS = [
  { arquivo: "rodada-sequencia-3", roteiro: "rodada" },
  { arquivo: "resultado-acerto", roteiro: "acerto" },
  { arquivo: "resultado-erro-fim-de-jogo", roteiro: "erro" },
] as const;

let browser: Browser | null = null;

try {
  await mkdir(DESTINO, { recursive: true });
  browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });

  for (const tela of ["desktop", "celular"] as const) {
    const context = await browser.newContext(
      tela === "desktop"
        ? { viewport: { width: 1440, height: 900 } }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    );
    const page = await context.newPage();
    await preparaAba(page);

    // Partida nova para cada viewport, para as duas capturas contarem a mesma
    // história: três países acertados, o quarto errado.
    rooms.playAgain(sala.code, sala.playerId);
    await rooms.startGame(sala.code, sala.playerId);
    for (let i = 0; i < 3; i++) {
      await palpita(PALPITE_CERTO);
      if (i < 2) await rooms.nextRound(sala.code, sala.playerId);
    }

    await page.goto(`${BASE}/streak/${sala.code}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    for (const { arquivo, roteiro } of TELAS) {
      if (roteiro === "rodada") {
        // Sequência em 3, rodada aberta: o número que a issue quer ver na tela.
        await rooms.nextRound(sala.code, sala.playerId);
      } else if (roteiro === "acerto") {
        await palpita(PALPITE_CERTO);
      } else {
        await rooms.nextRound(sala.code, sala.playerId);
        await palpita(PALPITE_ERRADO);
      }
      await captura(page, `${arquivo}-${tela}`);
    }

    await context.close();
  }
} finally {
  await browser?.close().catch(() => {});
  httpServer.close();
  io.close();
  process.exit(0);
}
