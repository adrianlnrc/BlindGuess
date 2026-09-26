/**
 * Teste do convite direto de amigo para a sala.
 *
 * Prova, contra um servidor de verdade:
 *  - amigo online recebe o convite e consegue entrar na sala;
 *  - quem NÃO é amigo não consegue convidar — nem mandando o `profileId` de
 *    outra pessoa no payload, o vetor corrigido na issue #8;
 *  - convite para amigo offline, para si mesmo, para fora de sala e para
 *    partida já começada falham com mensagem em vez de silêncio;
 *  - o convite chega em TODAS as abas da mesma pessoa (presença por perfil).
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-convite.ts
 *
 * Sem chave do Google Maps: a partida em andamento usa um desafio semeado com
 * locais fixos, como em scripts/teste-navegador.ts e teste-seguranca.ts.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { getPool, migrate } from "@/server/db";
import { createChallenge, getFriends } from "@/server/store";
import {
  DEFAULT_AVATAR,
  type ClientToServerEvents,
  type Convite,
  type Friend,
  type PlayerProfile,
  type RoomSettings,
  type RoomState,
  type ServerToClientEvents,
} from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3620);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";

type Cliente = Socket<ServerToClientEvents, ClientToServerEvents>;

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
  server.stderr?.on("data", (d: Buffer) => process.env.VERBOSE && process.stderr.write(`[srv] ${d}`));
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

// -------------------------------------------------------------------- socket

function conecta(): Promise<Cliente> {
  const socket: Cliente = io(BASE, {
    path: "/api/socket",
    transports: ["polling", "websocket"],
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

/** Emissão crua: é assim que um cliente malicioso ainda pode mandar profileId. */
function ataque<T>(socket: Cliente, evento: string, payload: Record<string, unknown>): Promise<T> {
  const cru = socket as unknown as {
    emit: (evento: string, payload: unknown, ack: (res: T) => void) => void;
  };
  return new Promise((resolve, reject) => {
    const alarme = setTimeout(() => reject(new Error(`${evento} não respondeu`)), 15_000);
    cru.emit(evento, payload, (res) => {
      clearTimeout(alarme);
      resolve(res);
    });
  });
}

type Ack = { ok: true } | { ok: false; error: string };

function convida(socket: Cliente, friendId: string): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const alarme = setTimeout(() => reject(new Error("convidarAmigo não respondeu")), 15_000);
    socket.emit("convidarAmigo", { friendId }, (res) => {
      clearTimeout(alarme);
      resolve(res);
    });
  });
}

function identify(socket: Cliente, profile: PlayerProfile): Promise<{ ok: boolean }> {
  return new Promise((resolve) => socket.emit("identify", { profile }, resolve));
}

function amigos(
  socket: Cliente,
): Promise<{ ok: true; myCode: string; friends: Friend[] } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("fetchFriends", resolve));
}

function criaSala(socket: Cliente, profile: PlayerProfile): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("createRoom", { profile }, resolve));
}

function entra(
  socket: Cliente,
  code: string,
  profile: PlayerProfile,
): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("joinRoom", { code, profile }, resolve));
}

/** Guarda os convites que chegarem nesta conexão. */
function escuta(socket: Cliente): Convite[] {
  const caixa: Convite[] = [];
  socket.on("convite", (c) => caixa.push(c));
  return caixa;
}

/** Espera o primeiro convite chegar na caixa. */
async function esperaConvite(caixa: Convite[], rotulo: string, timeoutMs = 5000): Promise<Convite> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (caixa.length > 0) return caixa[0];
    await sleep(100);
  }
  throw new Error(`convite não chegou (${rotulo})`);
}

function perfil(nome: string): PlayerProfile {
  return {
    id: `conv-${nome}-${Math.random().toString(36).slice(2, 8)}`,
    name: nome,
    avatar: { ...DEFAULT_AVATAR },
  };
}

/** Faz A e B virarem amigos de verdade, pelo código, como na interface. */
async function viraAmigos(socketA: Cliente, socketB: Cliente): Promise<void> {
  const listaB = await amigos(socketB);
  exige(listaB.ok, "não consegui o código de amigo");
  const res = await ataque<{ ok: boolean; error?: string }>(socketA, "addFriend", {
    code: listaB.myCode,
  });
  exige(res.ok, `addFriend falhou: ${res.error}`);
}

// ------------------------------------------------------------------- partida

const LOCAIS_FIXOS = [
  { lat: -23.5505, lng: -46.6333, panoId: "teste-convite-pano-sao-paulo" },
  { lat: 48.8566, lng: 2.3522, panoId: "teste-convite-pano-paris" },
];

const CONFIG_DESAFIO: RoomSettings = {
  rounds: LOCAIS_FIXOS.length,
  roundSeconds: 0,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

async function semeiaDesafio(): Promise<string> {
  await migrate();
  return createChallenge({
    creator: { id: "teste-convite-autor", name: "Teste de convite", avatar: { ...DEFAULT_AVATAR } },
    settings: CONFIG_DESAFIO,
    locations: LOCAIS_FIXOS,
  });
}

function esperaEstado(
  socket: Cliente,
  condicao: (state: RoomState) => boolean,
  rotulo: string,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const alarme = setTimeout(() => {
      socket.off("state", ouve);
      reject(new Error(`estado "${rotulo}" não chegou`));
    }, 30_000);

    const ouve = (state: RoomState) => {
      if (!condicao(state)) return;
      clearTimeout(alarme);
      socket.off("state", ouve);
      resolve(state);
    };

    socket.on("state", ouve);
  });
}

// ------------------------------------------------------------------ execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;

  const abertos: Cliente[] = [];
  const server = sobeServidor();

  try {
    await esperaServidor();
    console.log(`> servidor no ar em ${BASE}`);

    const codigoDesafio = await semeiaDesafio();
    console.log(`> desafio semeado: ${codigoDesafio}`);

    const A = perfil("anfitriao"); // cria a sala e convida
    const B = perfil("amigo"); // amigo de A, com duas abas
    const C = perfil("estranho"); // NÃO é amigo de A nem de B
    const D = perfil("ausente"); // amigo de A, mas sai antes do convite

    // --------------------------------------------------- montagem do cenário

    const socketA = await conecta();
    abertos.push(socketA);
    await identify(socketA, A);

    const abaB1 = await conecta();
    const abaB2 = await conecta();
    abertos.push(abaB1, abaB2);
    await identify(abaB1, B);
    await identify(abaB2, B);
    const caixaB1 = escuta(abaB1);
    const caixaB2 = escuta(abaB2);

    const socketC = await conecta();
    abertos.push(socketC);
    await identify(socketC, C);
    const caixaC = escuta(socketC);

    // D fica amigo de A e depois fecha o jogo: é o caso "amigo offline".
    const socketD = await conecta();
    await identify(socketD, D);
    await viraAmigos(socketA, socketD);
    socketD.close();
    await sleep(600);

    await viraAmigos(socketA, abaB1);
    const listaA = await getFriends(A.id, () => false);
    console.log(
      `> A tem ${listaA.length} amigos no banco (${listaA.map((f) => f.name).join(", ")}); C é estranho`,
    );

    const sala = await criaSala(socketA, A);
    exige(sala.ok, `A não criou a sala: ${sala.ok ? "" : sala.error}`);
    const codigo = sala.code;
    console.log(`> A abriu a sala ${codigo}`);

    // ------------------------------------------------------ 1. caminho feliz

    console.log("\n[1] amigo online recebe o convite e entra");

    await verifica("A convida B e o convite chega nas DUAS abas de B", async () => {
      const res = await convida(socketA, B.id);
      exige(res.ok, `convite recusado: ${res.ok ? "" : res.error}`);

      const c1 = await esperaConvite(caixaB1, "aba 1 de B");
      const c2 = await esperaConvite(caixaB2, "aba 2 de B");

      for (const [rotulo, c] of [["aba 1", c1], ["aba 2", c2]] as const) {
        exige(c.roomCode === codigo, `${rotulo} recebeu outra sala: ${c.roomCode}`);
        exige(c.deId === A.id, `${rotulo} recebeu outro convidante: ${c.deId}`);
        exige(c.deNome === A.name, `${rotulo} veio sem o nome de quem chamou: ${c.deNome}`);
        exige(!!c.deAvatar?.skin, `${rotulo} veio sem avatar`);
        exige(c.mode === "party", `${rotulo} veio com o modo errado: ${c.mode}`);
        exige(Math.abs(Date.now() - c.em) < 30_000, `${rotulo} veio com instante estranho: ${c.em}`);
      }

      return `duas abas receberam "${c1.deNome} → sala ${c1.roomCode}" (modo ${c1.mode})`;
    });

    await verifica("B entra na sala pelo código do convite", async () => {
      const convite = caixaB1[0];
      const res = await entra(abaB1, convite.roomCode, B);
      exige(res.ok, `B não entrou: ${res.ok ? "" : res.error}`);

      const estado = await esperaEstado(
        socketA,
        (s) => s.players.length === 2,
        "sala com duas pessoas",
      );
      exige(
        estado.players.some((p) => p.name === B.name),
        "B não apareceu na sala",
      );
      return `sala ${estado.code} com ${estado.players.map((p) => p.name).join(" e ")}`;
    });

    // ------------------------------------------------------ 2. só amigos

    console.log("\n[2] quem não é amigo não convida");

    const salaC = await criaSala(socketC, C);
    exige(salaC.ok, "C não criou a própria sala");

    await verifica("C (não-amigo) convidando A é recusado", async () => {
      const antes = caixaB1.length;
      const res = await convida(socketC, A.id);
      exige(!res.ok, "o convite do estranho passou!");
      exige(/amigo/i.test(res.error), `a mensagem não explica o motivo: "${res.error}"`);
      await sleep(400);
      exige(caixaB1.length === antes, "chegou convite para quem não era o alvo");
      exige(caixaC.length === 0, "o próprio estranho recebeu algum convite");
      return `recusado ("${res.error}")`;
    });

    await verifica("C mandando o profileId de A no payload não convida no lugar de A", async () => {
      const antesB1 = caixaB1.length;
      const antesB2 = caixaB2.length;

      // O vetor da issue #8: o atacante afirma ser outra pessoa no payload. Aqui
      // ele ainda tentaria usar a amizade A–B, que não é dele.
      const res = await ataque<Ack>(socketC, "convidarAmigo", {
        profileId: A.id,
        playerId: A.id,
        friendId: B.id,
      });

      exige(!res.ok, `o convite falsificado passou: ${JSON.stringify(res)}`);
      await sleep(500);
      exige(
        caixaB1.length === antesB1 && caixaB2.length === antesB2,
        "B recebeu um convite disparado pelo estranho",
      );
      return `recusado ("${res.ok ? "" : res.error}") e nenhuma aba de B foi notificada`;
    });

    await verifica("uma conexão sem identify não consegue convidar", async () => {
      const anonimo = await conecta();
      abertos.push(anonimo);
      const antes = caixaB1.length;

      const res = await ataque<Ack>(anonimo, "convidarAmigo", {
        profileId: A.id,
        friendId: B.id,
      });

      exige(!res.ok, "convite anônimo passou!");
      await sleep(400);
      exige(caixaB1.length === antes, "B recebeu convite de conexão anônima");
      return `recusado ("${res.ok ? "" : res.error}")`;
    });

    // --------------------------------------------- 3. convites sem sentido

    console.log("\n[3] convite que não faz sentido responde em vez de calar");

    await verifica("amigo offline é recusado com mensagem", async () => {
      const res = await convida(socketA, D.id);
      exige(!res.ok, "convite para amigo offline passou");
      exige(/aberto|online/i.test(res.error), `mensagem pouco clara: "${res.error}"`);
      return `recusado ("${res.error}")`;
    });

    await verifica("convite para si mesmo é recusado", async () => {
      const res = await convida(socketA, A.id);
      exige(!res.ok, "convite para si mesmo passou");
      return `recusado ("${res.ok ? "" : res.error}")`;
    });

    await verifica("quem não está em sala nenhuma não convida", async () => {
      const solto = await conecta();
      abertos.push(solto);
      await identify(solto, B); // é amigo de A, mas está fora de sala
      const res = await convida(solto, A.id);
      exige(!res.ok, "convite sem sala passou");
      exige(/sala/i.test(res.error), `mensagem não fala de sala: "${res.error}"`);
      return `recusado ("${res.error}")`;
    });

    await verifica("amigo desconhecido (id inventado) é recusado", async () => {
      const res = await convida(socketA, "nao-existe-esse-perfil");
      exige(!res.ok, "convite para id inventado passou");
      return `recusado ("${res.ok ? "" : res.error}")`;
    });

    await verifica("com a partida em andamento o convite é recusado", async () => {
      // Desafio semeado: dá para começar de verdade sem chave do Maps.
      const jogador = await conecta();
      abertos.push(jogador);
      await identify(jogador, A);

      const entrada = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
        jogador.emit("playChallenge", { profile: A, challengeCode: codigoDesafio }, resolve as never),
      );
      exige(entrada.ok, `playChallenge falhou: ${entrada.error}`);

      const jogando = esperaEstado(
        jogador,
        (s) => s.phase === "playing" && s.panorama !== null,
        "rodada em andamento",
      );
      jogador.emit("startGame");
      const estado = await jogando;

      const res = await convida(jogador, B.id);
      exige(!res.ok, "convite passou com a partida rodando");
      return `fase "${estado.phase}" → recusado ("${res.ok ? "" : res.error}")`;
    });
  } finally {
    for (const socket of abertos) socket.close();
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
  console.error("erro fatal no teste de convite:", err);
  process.exit(1);
});
