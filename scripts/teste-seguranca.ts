/**
 * Teste de segurança da identidade no socket.
 *
 * Prova que a identidade de quem fala mora na conexão — sessão do banco para
 * quem está logado, `identify` para convidado — e que o `profileId` enviado no
 * payload é ignorado. Antes da correção, qualquer pessoa copiava o `profileId`
 * de outra do ranking e gastava as moedas dela.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-seguranca.ts
 *
 * Sem chave do Google Maps: a partida da vítima acontece num desafio semeado
 * com locais fixos, como em scripts/teste-navegador.ts.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { getPool, migrate } from "@/server/db";
import { createChallenge, getFriends, getWallet } from "@/server/store";
import {
  DEFAULT_AVATAR,
  type ClientToServerEvents,
  type Friend,
  type PlayerProfile,
  type RoomSettings,
  type RoomState,
  type ServerToClientEvents,
} from "@/lib/types";

const PORT = Number(process.env.PORT_TESTE ?? 3600);
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";

/** Item caro o bastante para só a vítima poder pagar. */
const ITEM_ALVO = "hat_crown"; // 1500 moedas
const SALDO_VITIMA = 2000;

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

function conecta(cookie?: string): Promise<Cliente> {
  const socket: Cliente = io(BASE, {
    path: "/api/socket",
    transports: ["polling", "websocket"],
    forceNew: true,
    extraHeaders: cookie ? { cookie } : undefined,
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

type IdentifyAck =
  | { ok: true; profile: PlayerProfile; authenticated: boolean; email: string | null }
  | { ok: false; error: string };

function identify(socket: Cliente, profile: PlayerProfile): Promise<IdentifyAck> {
  return new Promise((resolve) => socket.emit("identify", { profile }, resolve));
}

function carteira(socket: Cliente): Promise<{ coins: number; items: string[] }> {
  return new Promise((resolve) => socket.emit("fetchWallet", resolve));
}

function amigos(
  socket: Cliente,
): Promise<{ ok: true; myCode: string; friends: Friend[] } | { ok: false; error: string }> {
  return new Promise((resolve) => socket.emit("fetchFriends", resolve));
}

function perfil(nome: string): PlayerProfile {
  return {
    id: `seg-${nome}-${Math.random().toString(36).slice(2, 8)}`,
    name: nome,
    avatar: { ...DEFAULT_AVATAR },
  };
}

// ------------------------------------------------------------------- partida

const LOCAIS_FIXOS = [
  { lat: -23.5505, lng: -46.6333, panoId: "teste-seg-pano-sao-paulo" },
  { lat: 48.8566, lng: 2.3522, panoId: "teste-seg-pano-paris" },
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
    creator: { id: "teste-seguranca-autor", name: "Teste de segurança", avatar: { ...DEFAULT_AVATAR } },
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

/** Joga o desafio semeado até o fim, para a vítima existir no banco com moedas. */
async function jogaDesafio(socket: Cliente, profile: PlayerProfile, challengeCode: string): Promise<number> {
  const entrada = await new Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }>(
    (resolve) => socket.emit("playChallenge", { profile, challengeCode }, resolve),
  );
  exige(entrada.ok, `playChallenge falhou: ${entrada.ok ? "" : entrada.error}`);

  for (let rodada = 1; rodada <= LOCAIS_FIXOS.length; rodada += 1) {
    const jogando = esperaEstado(
      socket,
      (s) => s.phase === "playing" && s.round === rodada && s.panorama !== null,
      `rodada ${rodada} jogando`,
    );
    if (rodada === 1) socket.emit("startGame");
    else socket.emit("nextRound");
    await jogando;

    const resultado = esperaEstado(socket, (s) => s.phase === "round-result", `rodada ${rodada} resultado`);
    socket.emit("submitGuess", { position: { lat: LOCAIS_FIXOS[rodada - 1].lat, lng: LOCAIS_FIXOS[rodada - 1].lng } });
    await resultado;
  }

  const fim = esperaEstado(socket, (s) => s.phase === "finished", "partida encerrada");
  socket.emit("nextRound");
  const final = await fim;

  // A gravação no banco acontece logo depois do broadcast de "finished".
  await sleep(1500);
  return final.players.find((p) => p.name === profile.name)?.totalScore ?? 0;
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

    const A = perfil("vitima");
    const B = perfil("atacante");
    const C = perfil("terceiro");
    const D = perfil("amigo");

    // ---------------------------------------------------- vítima joga e ganha

    console.log("\n[1] convidado A joga, é identificado e tem carteira própria");
    const socketA = await conecta();
    abertos.push(socketA);

    await verifica("A se identifica e joga o desafio semeado", async () => {
      const ack = await identify(socketA, A);
      exige(ack.ok, `identify de A recusado: ${ack.ok ? "" : ack.error}`);
      exige(ack.profile.id === A.id, "o servidor devolveu outro id para A");

      const pontos = await jogaDesafio(socketA, A, codigoDesafio);
      const wallet = await getWallet(A.id);
      exige(wallet.coins > 0, `A terminou a partida sem moedas (pontos ${pontos})`);
      return `A fez ${pontos} pontos e ganhou ${wallet.coins} moedas`;
    });

    // Moedas de partida são poucas; para a compra ser possível, a vítima recebe
    // um saldo conhecido. É esse saldo que precisa continuar intacto no fim.
    await getPool().query(`UPDATE players SET coins = $2 WHERE id = $1`, [A.id, SALDO_VITIMA]);
    const saldoInicialA = (await getWallet(A.id)).coins;
    console.log(`  ..   saldo de A fixado em ${saldoInicialA} moedas`);

    // A faz amizade com D, para o ataque de removeFriend ter o que apagar.
    const socketD = await conecta();
    abertos.push(socketD);
    await identify(socketD, D);
    const listaD = await amigos(socketD);
    exige(listaD.ok, "D não conseguiu o próprio código de amigo");
    const codigoD = listaD.myCode;

    const adicionaD = await ataque<{ ok: boolean; error?: string }>(socketA, "addFriend", { code: codigoD });
    exige(adicionaD.ok, `A não conseguiu adicionar D: ${adicionaD.error}`);

    // C existe só para o atacante tentar plantar uma amizade na conta de A.
    const socketC = await conecta();
    abertos.push(socketC);
    await identify(socketC, C);
    const listaC = await amigos(socketC);
    exige(listaC.ok, "C não conseguiu o próprio código de amigo");
    const codigoC = listaC.myCode;

    console.log(`  ..   A é amigo de D; código de amigo de C é ${codigoC}`);

    // -------------------------------------------------------------- ataques

    console.log("\n[2] convidado B tenta agir no lugar de A mandando o profileId de A");
    const socketB = await conecta();
    abertos.push(socketB);
    const ackB = await identify(socketB, B);
    exige(ackB.ok, "identify de B falhou");

    await verifica("buyItem com o profileId de A é recusado e o saldo de A fica intacto", async () => {
      const res = await ataque<{ ok: boolean; error?: string; coins?: number }>(socketB, "buyItem", {
        profileId: A.id,
        itemId: ITEM_ALVO,
      });

      const depois = await getWallet(A.id);
      const carteiraB = await getWallet(B.id);

      exige(!res.ok, `a compra passou! resposta: ${JSON.stringify(res)}`);
      exige(
        depois.coins === saldoInicialA,
        `o saldo de A mudou: ${saldoInicialA} → ${depois.coins}`,
      );
      exige(!depois.items.includes(ITEM_ALVO), "o item foi entregue na conta de A");
      exige(!carteiraB.items.includes(ITEM_ALVO), "B levou o item usando o saldo de A");
      return `recusado ("${res.error}"), saldo de A segue ${depois.coins} e sem o item`;
    });

    await verifica("fetchWallet com o profileId de A devolve a carteira de B", async () => {
      const res = await ataque<{ coins: number; items: string[] }>(socketB, "fetchWallet", {
        profileId: A.id,
      });
      exige(
        res.coins !== saldoInicialA,
        `B recebeu o saldo de A (${res.coins})`,
      );
      exige(res.coins === 0, `B recebeu um saldo que não é o dele: ${res.coins}`);
      return `B recebeu ${res.coins} moedas (as dele), não as ${saldoInicialA} de A`;
    });

    await verifica("fetchFriends com o profileId de A devolve a lista de B", async () => {
      const res = await ataque<
        { ok: true; myCode: string; friends: Friend[] } | { ok: false; error: string }
      >(socketB, "fetchFriends", { profileId: A.id });
      exige(res.ok, `fetchFriends de B falhou: ${res.ok ? "" : res.error}`);

      const codigoA = await ataque<{ ok: true; myCode: string } | { ok: false; error: string }>(
        socketA,
        "fetchFriends",
        {},
      );
      exige(codigoA.ok, "A não conseguiu a própria lista");
      exige(res.myCode !== codigoA.myCode, "B recebeu o código de amigo de A");
      exige(
        !res.friends.some((f) => f.profileId === D.id),
        "B viu a lista de amigos de A",
      );
      return `B recebeu o próprio código (${res.myCode}) e ${res.friends.length} amigos`;
    });

    await verifica("addFriend com o profileId de A não planta amizade na conta de A", async () => {
      const res = await ataque<{ ok: boolean; error?: string; friends?: Friend[] }>(
        socketB,
        "addFriend",
        { profileId: A.id, code: codigoC },
      );

      const deA = await getFriends(A.id, () => false);
      const deB = await getFriends(B.id, () => false);

      exige(
        !deA.some((f) => f.profileId === C.id),
        "C entrou na lista de amigos de A",
      );
      exige(
        deB.some((f) => f.profileId === C.id),
        `a amizade não foi para B, que era quem estava falando: ${JSON.stringify(res)}`,
      );
      return `a amizade caiu na conta de B (${deB.length} amigos); A segue com ${deA.length}`;
    });

    await verifica("removeFriend com o profileId de A não apaga as amizades de A", async () => {
      const res = await ataque<{ ok: boolean; error?: string }>(socketB, "removeFriend", {
        profileId: A.id,
        friendId: D.id,
      });

      const deA = await getFriends(A.id, () => false);
      exige(
        deA.some((f) => f.profileId === D.id),
        `a amizade de A com D foi apagada: ${JSON.stringify(res)}`,
      );
      return `A continua amigo de D (${deA.length} amigos na lista)`;
    });

    await verifica("fetchDaily com o profileId de A não expõe a partida de A", async () => {
      const res = await ataque<
        { ok: true; daily: { alreadyPlayed: boolean; myScore: number | null } } | { ok: false; error: string }
      >(socketB, "fetchDaily", { profileId: A.id });

      // Sem chave do Maps o desafio do dia pode não existir; o que não pode é
      // o servidor responder sobre a partida de outra pessoa.
      if (!res.ok) return `desafio do dia indisponível neste ambiente ("${res.error}")`;
      exige(res.daily.myScore === null, `B recebeu a pontuação de alguém: ${res.daily.myScore}`);
      return `alreadyPlayed=${res.daily.alreadyPlayed}, myScore=${res.daily.myScore}`;
    });

    await verifica("identify com o id de A não faz B agir como A", async () => {
      const ack = await identify(socketB, { ...A, name: "impostor" });
      exige(ack.ok, `identify recusado: ${ack.ok ? "" : ack.error}`);
      exige(ack.profile.id !== A.id, "o servidor aceitou B como sendo A");
      exige(ack.profile.id === B.id, `a identidade da conexão mudou: ${ack.profile.id}`);

      const minha = await carteira(socketB);
      exige(minha.coins !== saldoInicialA, "B passou a ver o saldo de A");

      const compra = await ataque<{ ok: boolean; error?: string }>(socketB, "buyItem", {
        itemId: ITEM_ALVO,
      });
      const depois = await getWallet(A.id);
      exige(!compra.ok, "B comprou depois de se declarar A");
      exige(depois.coins === saldoInicialA, `o saldo de A mudou: ${depois.coins}`);

      const nomeA = await getPool().query<{ name: string }>(`SELECT name FROM players WHERE id = $1`, [
        A.id,
      ]);
      exige(nomeA.rows[0]?.name === A.name, `o apelido de A foi sobrescrito: ${nomeA.rows[0]?.name}`);
      return `a conexão de B continuou sendo B (${ack.profile.id}) e o perfil de A ficou intacto`;
    });

    // ------------------------------------------------- caminho feliz segue

    console.log("\n[3] o fluxo normal do convidado continua funcionando");
    await verifica("A compra com o próprio saldo e vê a compra na carteira", async () => {
      const compra = await ataque<{ ok: boolean; error?: string; coins?: number; items?: string[] }>(
        socketA,
        "buyItem",
        { itemId: ITEM_ALVO },
      );
      exige(compra.ok, `A não conseguiu comprar: ${compra.error}`);

      const wallet = await carteira(socketA);
      exige(wallet.items.includes(ITEM_ALVO), "o item não apareceu na carteira de A");
      exige(
        wallet.coins === saldoInicialA - 1500,
        `o débito saiu errado: ${saldoInicialA} → ${wallet.coins}`,
      );
      return `A pagou 1500 e ficou com ${wallet.coins} moedas e ${wallet.items.length} item(ns)`;
    });

    await verifica("uma conexão nova de convidado sem identify não recebe carteira nem amigos", async () => {
      const anonimo = await conecta();
      abertos.push(anonimo);

      const wallet = await ataque<{ coins: number; items: string[] }>(anonimo, "fetchWallet", {
        profileId: A.id,
      });
      const lista = await ataque<{ ok: boolean; error?: string }>(anonimo, "fetchFriends", {
        profileId: A.id,
      });
      const compra = await ataque<{ ok: boolean; error?: string }>(anonimo, "buyItem", {
        profileId: A.id,
        itemId: "hat_bucket",
      });
      const depois = await getWallet(A.id);

      exige(wallet.coins === 0 && wallet.items.length === 0, `carteira veio preenchida: ${JSON.stringify(wallet)}`);
      exige(!lista.ok, "a lista de amigos veio sem identificação");
      exige(!compra.ok, "a compra passou sem identificação");
      exige(!depois.items.includes("hat_bucket"), "o item foi entregue na conta de A");
      return `carteira vazia, amigos recusados ("${lista.error}") e compra recusada ("${compra.error}")`;
    });

    // ------------------------------------------------------- usuário logado

    console.log("\n[4] usuário logado tem a identidade vinda da sessão");
    const token = randomUUID();
    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id`,
      ["Teste Logado", `seguranca-${token.slice(0, 8)}@exemplo.test`],
    );
    const userId = rows[0].id;
    await getPool().query(
      `INSERT INTO sessions ("userId", expires, "sessionToken") VALUES ($1, now() + interval '1 day', $2)`,
      [userId, token],
    );
    const cookie = `authjs.session-token=${token}`;

    let idLogado = "";
    await verifica("logado se identifica pela sessão e a conta recebe o perfil", async () => {
      const logado = await conecta(cookie);
      abertos.push(logado);

      const ack = await identify(logado, perfil("logado"));
      exige(ack.ok, `identify do logado falhou: ${ack.ok ? "" : ack.error}`);
      exige(ack.authenticated, "o servidor não reconheceu a sessão");
      idLogado = ack.profile.id;

      const vinculo = await getPool().query<{ id: string }>(
        `SELECT id FROM players WHERE user_id = $1`,
        [userId],
      );
      exige(vinculo.rows[0]?.id === idLogado, "o perfil não ficou ligado à conta");
      return `sessão reconhecida, perfil da conta = ${idLogado}`;
    });

    await getPool().query(`UPDATE players SET coins = 500 WHERE id = $1`, [idLogado]);

    await verifica("conexão logada lê a própria carteira sem identify e ignora profileId alheio", async () => {
      const logado = await conecta(cookie);
      abertos.push(logado);

      const wallet = await ataque<{ coins: number; items: string[] }>(logado, "fetchWallet", {
        profileId: A.id,
      });
      exige(wallet.coins === 500, `a carteira não veio da sessão: ${JSON.stringify(wallet)}`);

      const compra = await ataque<{ ok: boolean; error?: string }>(logado, "buyItem", {
        profileId: A.id,
        itemId: "hat_bucket",
      });
      const depoisA = await getWallet(A.id);
      const daConta = await getWallet(idLogado);

      exige(!depoisA.items.includes("hat_bucket"), "o logado comprou com as moedas de A");
      exige(depoisA.coins === saldoInicialA - 1500, `o saldo de A mudou: ${depoisA.coins}`);
      exige(compra.ok, `o logado não conseguiu comprar o próprio item: ${compra.error}`);
      exige(daConta.items.includes("hat_bucket"), "o item não foi para a conta logada");
      return `carteira da sessão (500 moedas) e compra debitada na conta, não em A`;
    });
    console.log("\n[5] o perfil que chega do cliente é saneado antes de valer");
    // `loadProfile` no navegador aceita o que estiver no localStorage sem
    // conferir a forma, e esse perfil e transmitido a todos na sala. E este
    // portao que torna aquela frouxidao inofensiva: se ele cair, avatar
    // inventado e id com caractere estranho passam a circular entre jogadores.
    await verifica("id com caractere estranho é limpo, não aceito como veio", async () => {
      const socket = await conecta();
      abertos.push(socket);

      const res = await identify(socket, {
        id: "../../etc/passwd; DROP TABLE players--",
        name: "Perfil torto",
        avatar: { ...DEFAULT_AVATAR },
      });
      exige(res.ok, `identify recusou: ${res.ok ? "" : res.error}`);
      exige(
        /^[a-zA-Z0-9_-]+$/.test(res.profile.id),
        `o id voltou com caractere perigoso: ${res.profile.id}`,
      );
      exige(res.profile.id.length <= 40, `o id voltou com ${res.profile.id.length} caracteres`);
      return `id saneado para "${res.profile.id}"`;
    });

    await verifica("chapéu e rosto inventados voltam para o padrão", async () => {
      const socket = await conecta();
      abertos.push(socket);

      const res = await identify(socket, {
        id: "seg-avatar-torto",
        name: "Avatar torto",
        avatar: {
          skin: "javascript:alert(1)",
          outfit: "#16b886",
          accent: "não é cor",
          hat: "chapeu-que-nao-existe" as never,
          face: "rosto-inventado" as never,
        },
      });
      exige(res.ok, `identify recusou: ${res.ok ? "" : res.error}`);

      const a = res.profile.avatar;
      exige(a.hat === DEFAULT_AVATAR.hat, `o chapéu inventado passou: ${a.hat}`);
      exige(a.face === DEFAULT_AVATAR.face, `o rosto inventado passou: ${a.face}`);
      exige(/^#[0-9a-fA-F]{6}$/.test(a.skin), `a pele não virou cor: ${a.skin}`);
      exige(/^#[0-9a-fA-F]{6}$/.test(a.accent), `o detalhe não virou cor: ${a.accent}`);
      exige(a.outfit === "#16b886", `a cor válida foi descartada: ${a.outfit}`);
      return `chapéu → ${a.hat}, rosto → ${a.face}, cores → ${a.skin}/${a.accent}`;
    });

    await verifica("perfil sem nome é recusado", async () => {
      const socket = await conecta();
      abertos.push(socket);

      const res = await identify(socket, {
        id: "seg-sem-nome",
        name: "   ",
        avatar: { ...DEFAULT_AVATAR },
      });
      exige(!res.ok, "um perfil sem nome foi aceito");
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
  console.error("erro fatal no teste de segurança:", err);
  process.exit(1);
});
