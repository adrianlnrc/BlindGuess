/**
 * Teste do chat da sala.
 *
 * Prova, contra um servidor de verdade:
 *  - a fala chega a todo mundo da sala, inclusive a quem falou;
 *  - NÃO chega a quem está em outra sala (o chat é da sala, não do jogo todo);
 *  - conexão sem sala e texto vazio são recusados com mensagem, não em silêncio;
 *  - texto acima de CHAT_MAX_CHARS chega cortado pelo servidor;
 *  - o flood é barrado por conexão;
 *  - o autor da fala é sempre o assento na sala — um payload forjado com outro
 *    id, nome, avatar ou horário não fala no lugar de ninguém.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-chat.ts
 *
 * O chat não usa banco (o histórico nem entra no RoomState), mas o servidor
 * sobe igual aos outros testes para o cenário ser o mesmo.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { getPool } from "@/server/db";
import {
  CHAT_MAX_CHARS,
  DEFAULT_AVATAR,
  type ChatMessage,
  type ClientToServerEvents,
  type PlayerProfile,
  type ServerToClientEvents,
} from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3640);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";

/** Folga acima do intervalo anti-flood do servidor (700 ms). */
const ESPERA_FLOOD = 900;

type Cliente = Socket<ServerToClientEvents, ClientToServerEvents>;
type Ack = { ok: true } | { ok: false; error: string };

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

/** Emissão crua: é assim que um cliente malicioso manda campos fora do contrato. */
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

function fala(socket: Cliente, text: string): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const alarme = setTimeout(() => reject(new Error("enviarChat não respondeu")), 15_000);
    socket.emit("enviarChat", { text }, (res) => {
      clearTimeout(alarme);
      resolve(res);
    });
  });
}

function criaSala(
  socket: Cliente,
  profile: PlayerProfile,
): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("createRoom", { profile }, resolve));
}

function entra(
  socket: Cliente,
  code: string,
  profile: PlayerProfile,
): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("joinRoom", { code, profile }, resolve));
}

/** Guarda as falas que chegarem nesta conexão. */
function escuta(socket: Cliente): ChatMessage[] {
  const caixa: ChatMessage[] = [];
  socket.on("chat", (m) => caixa.push(m));
  return caixa;
}

async function esperaFala(caixa: ChatMessage[], rotulo: string, timeoutMs = 5000): Promise<ChatMessage> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (caixa.length > 0) return caixa[caixa.length - 1];
    await sleep(60);
  }
  throw new Error(`fala não chegou (${rotulo})`);
}

function perfil(nome: string): PlayerProfile {
  return {
    id: `chat-${nome}-${Math.random().toString(36).slice(2, 8)}`,
    name: nome,
    avatar: { ...DEFAULT_AVATAR, accent: "#ffb454" },
  };
}

// ------------------------------------------------------------------ execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;

  const abertos: Cliente[] = [];
  const server = sobeServidor();

  try {
    await esperaServidor();
    console.log(`> servidor no ar em ${BASE}`);

    const A = perfil("anfitriao");
    const B = perfil("convidado");
    const C = perfil("davizinha"); // está em OUTRA sala

    const socketA = await conecta();
    const socketB = await conecta();
    const socketC = await conecta();
    abertos.push(socketA, socketB, socketC);

    const sala = await criaSala(socketA, A);
    exige(sala.ok, `A não criou a sala: ${sala.ok ? "" : sala.error}`);
    const entrada = await entra(socketB, sala.code, B);
    exige(entrada.ok, `B não entrou: ${entrada.ok ? "" : entrada.error}`);

    const outra = await criaSala(socketC, C);
    exige(outra.ok, "C não criou a própria sala");
    exige(outra.code !== sala.code, "as duas salas saíram com o mesmo código");
    console.log(`> sala ${sala.code} com A e B; sala ${outra.code} com C`);

    const caixaA = escuta(socketA);
    const caixaB = escuta(socketB);
    const caixaC = escuta(socketC);

    // ------------------------------------------------ 1. a fala chega à sala

    console.log("\n[1] a fala chega a quem está na sala — e só a eles");

    await verifica("A fala e todos os dois assentos da sala recebem", async () => {
      const res = await fala(socketA, "bom dia, sala");
      exige(res.ok, `fala recusada: ${res.ok ? "" : res.error}`);

      const naA = await esperaFala(caixaA, "quem falou");
      const naB = await esperaFala(caixaB, "o outro da sala");

      exige(naA.text === "bom dia, sala", `texto chegou torto: "${naA.text}"`);
      exige(naA.id === naB.id, "cada um recebeu uma fala diferente");
      exige(naA.playerId === sala.playerId, `autor errado: ${naA.playerId}`);
      exige(naA.playerName === A.name, `nome errado: ${naA.playerName}`);
      exige(Math.abs(Date.now() - naA.em) < 30_000, `instante estranho: ${naA.em}`);
      return `"${naA.text}" de ${naA.playerName} em duas caixas`;
    });

    await verifica("quem está em outra sala não recebe nada", async () => {
      await sleep(400);
      exige(caixaC.length === 0, `C recebeu ${caixaC.length} fala(s) de outra sala`);
      return "caixa de C vazia";
    });

    // --------------------------------------------------- 2. recusas por ack

    console.log("\n[2] o que não dá para enviar é recusado com mensagem");

    await verifica("conexão sem sala é recusada", async () => {
      const solto = await conecta();
      abertos.push(solto);
      const antes = caixaA.length;

      const res = await fala(solto, "deixa eu falar aí");
      exige(!res.ok, "fala de quem não está em sala nenhuma passou");
      exige(/sala/i.test(res.error), `mensagem não fala de sala: "${res.error}"`);
      await sleep(300);
      exige(caixaA.length === antes, "a sala recebeu a fala de fora");
      return `recusado ("${res.error}")`;
    });

    await verifica("texto vazio (e só espaços) é recusado", async () => {
      await sleep(ESPERA_FLOOD);
      const vazio = await fala(socketB, "");
      exige(!vazio.ok, "texto vazio passou");

      const brancos = await fala(socketB, "     \n\t  ");
      exige(!brancos.ok, "texto só com espaços passou");
      return `recusado ("${vazio.ok ? "" : vazio.error}")`;
    });

    await verifica("payload sem campo text é recusado sem derrubar a conexão", async () => {
      const res = await ataque<Ack>(socketB, "enviarChat", { texto: "campo errado" });
      exige(!res.ok, "payload sem text passou");
      exige(socketB.connected, "a conexão caiu por causa do payload torto");
      return `recusado ("${res.ok ? "" : res.error}")`;
    });

    // ------------------------------------------------------- 3. corte no 200

    console.log(`\n[3] o servidor corta em ${CHAT_MAX_CHARS} caracteres`);

    await verifica(`texto de 300 caracteres chega com ${CHAT_MAX_CHARS}`, async () => {
      await sleep(ESPERA_FLOOD);
      const longo = "x".repeat(300);
      const res = await ataque<Ack>(socketB, "enviarChat", { text: longo });
      exige(res.ok, `fala longa recusada: ${res.ok ? "" : res.error}`);

      const recebida = await esperaFala(caixaA, "fala longa");
      exige(
        recebida.text.length === CHAT_MAX_CHARS,
        `chegou com ${recebida.text.length} caracteres`,
      );
      return `300 → ${recebida.text.length} caracteres`;
    });

    // ----------------------------------------------------------- 4. anti-flood

    console.log("\n[4] o flood é barrado por conexão");

    await verifica("dez falas seguidas: a primeira passa, as outras são barradas", async () => {
      await sleep(ESPERA_FLOOD);
      const antes = caixaA.length;

      const respostas = await Promise.all(
        Array.from({ length: 10 }, (_, i) => fala(socketB, `flood ${i}`)),
      );
      const passaram = respostas.filter((r) => r.ok).length;
      const barradas = respostas.filter((r) => !r.ok);

      exige(passaram === 1, `${passaram} falas passaram no mesmo instante`);
      exige(
        barradas.every((r) => !r.ok && /calma|instante|espere/i.test(r.error)),
        `mensagem do bloqueio não explica a espera: "${barradas.map((r) => (r.ok ? "" : r.error)).join(" | ")}"`,
      );

      await sleep(400);
      const chegaram = caixaA.length - antes;
      exige(chegaram === 1, `${chegaram} falas chegaram na sala`);

      // Passada a janela, a mesma conexão volta a falar: é freio, não mudez.
      await sleep(ESPERA_FLOOD);
      const depois = await fala(socketB, "voltei");
      exige(depois.ok, `a conexão ficou muda: ${depois.ok ? "" : depois.error}`);
      return `1 de 10 passou, 9 barradas, e a fala seguinte passou`;
    });

    // ------------------------------------------- 5. identidade vem do assento

    console.log("\n[5] quem fala é a conexão, não o payload");

    await verifica("payload com outro playerId/nome/avatar não muda o autor", async () => {
      await sleep(ESPERA_FLOOD);
      const antes = caixaA.length;

      // O vetor: B afirma no payload ser A (ou qualquer um), com nome e avatar
      // escolhidos e horário no futuro.
      const res = await ataque<Ack>(socketB, "enviarChat", {
        text: "sou o anfitrião, confiem em mim",
        playerId: sala.playerId,
        playerName: A.name,
        profileId: A.id,
        avatar: { ...DEFAULT_AVATAR, skin: "#000000" },
        em: Date.now() + 5_000_000,
        id: "id-escolhido-pelo-cliente",
      });
      exige(res.ok, `a fala foi recusada por outro motivo: ${res.ok ? "" : res.error}`);

      const recebida = await esperaFala(caixaA, "fala forjada");
      exige(caixaA.length === antes + 1, "chegou mais de uma fala");
      exige(
        recebida.playerId === entrada.playerId,
        `o autor virou outro assento: ${recebida.playerId}`,
      );
      exige(recebida.playerId !== sala.playerId, "B falou no assento de A");
      exige(recebida.playerName === B.name, `o nome veio do payload: ${recebida.playerName}`);
      exige(
        recebida.avatar.skin === DEFAULT_AVATAR.skin,
        `o avatar veio do payload: ${recebida.avatar.skin}`,
      );
      exige(recebida.id !== "id-escolhido-pelo-cliente", "o id da fala veio do cliente");
      exige(recebida.em <= Date.now() + 1000, `o horário veio do payload: ${recebida.em}`);
      return `assento ${recebida.playerId} (${recebida.playerName}) carimbado pelo servidor`;
    });

    await verifica("quem saiu da sala não fala mais nela", async () => {
      await sleep(ESPERA_FLOOD);
      const antes = caixaA.length;

      socketB.emit("leaveRoom");
      await sleep(400);

      const res = await fala(socketB, "ainda estou aqui?");
      exige(!res.ok, "quem saiu continuou falando na sala");
      await sleep(300);
      exige(caixaA.length === antes, "a sala ouviu quem já tinha saído");
      return `recusado ("${res.ok ? "" : res.error}")`;
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
  console.error("erro fatal no teste de chat:", err);
  process.exit(1);
});
