import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer, type Socket } from "socket.io";
import {
  CHAT_MAX_CHARS,
  DEFAULT_AVATAR,
  type Avatar,
  type ChatMessage,
  type ClientToServerEvents,
  type Convite,
  type PlayerProfile,
  type ServerToClientEvents,
} from "./src/lib/types.ts";
import { getPool, hasDatabase, migrate } from "./src/server/db.ts";
import { RoomManager } from "./src/server/rooms.ts";
import { userFromCookieHeader } from "./src/server/session.ts";
import { paidItemFor } from "./src/lib/shop.ts";
import {
  addFriendByCode,
  areFriends,
  buyItem,
  claimGuest,
  getChallengeSummary,
  getFriendCode,
  getFriends,
  getLeaderboards,
  getOwnedItems,
  getPlayerForUser,
  getStats,
  getWallet,
  nextDailyResetAt,
  removeFriend,
  saveProfile,
} from "./src/server/store.ts";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

type SocketData = {
  playerId?: string;
  roomCode?: string;
  profileId?: string;
  /** Instante da última fala no chat — base do anti-flood, por conexão. */
  ultimaFala?: number;
};
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

if (hasDatabase()) {
  await migrate();
  console.log("> banco conectado e schema aplicado");
} else {
  console.warn("! DATABASE_URL não definida — login, ranking e streak ficam desligados");
}

const httpServer = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[next]", err);
    res.statusCode = 500;
    res.end("Internal server error");
  });
});

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, never, SocketData>(
  httpServer,
  { path: "/api/socket" },
);

const rooms = new RoomManager((code) => {
  const state = rooms.getState(code);
  if (state) io.to(code).emit("state", state);
});

function push(socket: GameSocket): void {
  const code = socket.data.roomCode;
  if (!code) return;
  const state = rooms.getState(code);
  if (state) socket.emit("state", state);
}

/**
 * Eventos que só levam o ack. Uma aba aberta antes desta mudança ainda manda o
 * payload com `profileId` na frente; o payload é descartado (a identidade vem
 * da conexão) e o ack é achado entre os argumentos, para a aba velha receber
 * resposta em vez de ficar esperando para sempre.
 */
type SoAck = "fetchWallet" | "fetchFriends" | "fetchDaily";

function ackOnly<E extends SoAck>(
  handler: (ack: Parameters<ClientToServerEvents[E]>[0]) => void,
): ClientToServerEvents[E] {
  return ((...args: unknown[]) => {
    const ack = args.find((arg) => typeof arg === "function");
    if (ack) handler(ack as Parameters<ClientToServerEvents[E]>[0]);
  }) as ClientToServerEvents[E];
}

/**
 * Quantas pessoas cabem numa sala que não é duelo — o mesmo limite aplicado em
 * `RoomManager.joinRoom`. Serve para recusar o convite antes de mandá-lo, em
 * vez de o amigo descobrir a lotação só ao tentar entrar.
 */
const LOTACAO_MAXIMA = 12;

/**
 * Intervalo mínimo entre duas falas da mesma conexão. Sem isso um script
 * enche a sala mais rápido do que qualquer pessoa consegue ler.
 */
const INTERVALO_FALA_MS = 700;

/** Resposta para quem pede algo pessoal antes de dizer quem é. */
const NAO_IDENTIFICADO = "Identifique-se antes de usar este recurso.";

/** Erro numa ação que responde por ack, sem derrubar a conexão. */
function fail(err: unknown, label: string, ack: (res: { ok: false; error: string }) => void): void {
  console.error(`[${label}]`, err);
  ack({ ok: false, error: "Algo deu errado aqui do meu lado. Tente de novo." });
}

/**
 * Descobre com quem estamos falando. Para quem está logado, a identidade vem
 * do banco pela sessão — o id que o cliente manda é ignorado, senão qualquer
 * um poderia escrever no ranking alheio. Convidado segue usando o id local.
 */
async function resolveProfile(
  socket: GameSocket,
  raw: unknown,
): Promise<{ profile: PlayerProfile; authenticated: boolean; email: string | null } | null> {
  const user = hasDatabase()
    ? await userFromCookieHeader(socket.handshake.headers.cookie)
    : null;

  let clean = sanitizeProfile(raw);

  // Quem acabou de entrar com o Google ainda não escolheu apelido: usa o nome da conta.
  if (!clean && user?.name) {
    clean = sanitizeProfile({ ...(raw as object), name: user.name });
  }

  if (!clean) return null;

  if (!user) {
    // A identidade do convidado é fixada na primeira identificação desta
    // conexão. Se depois chegar outro id — o `profileId` de alguém copiado do
    // ranking, por exemplo — ele é ignorado: a conexão continua sendo quem já
    // era, e apelido e avatar entram no perfil dela.
    const pinned = socket.data.profileId;
    if (pinned && pinned !== clean.id) clean = { ...clean, id: pinned };

    if (hasDatabase()) {
      clean = await enforceOwnership(clean);
      await saveProfile(clean).catch((err) => console.error("[profile]", err));
    }
    trackPresence(socket, clean.id);
    return { profile: clean, authenticated: false, email: null };
  }

  // Primeiro login: adota o perfil de convidado, preservando streak e pontos.
  const owned =
    (await getPlayerForUser(user.id)) ??
    (await claimGuest(user.id, clean.id, { name: clean.name, avatar: clean.avatar }));

  const profile = await enforceOwnership({ id: owned.id, name: clean.name, avatar: clean.avatar });
  await saveProfile(profile);
  trackPresence(socket, profile.id);

  return { profile, authenticated: true, email: user.email };
}

/**
 * Sala interna com todas as conexões de um mesmo perfil. É por ela que o
 * convite chega em todas as abas da pessoa. O nome tem `:` e minúsculas, que
 * nunca aparecem num código de sala, então não colide com as salas de jogo.
 */
function perfilRoom(profileId: string): string {
  return `perfil:${profileId}`;
}

/** Amarra a presença do perfil a esta conexão, trocando se a identidade mudar. */
function trackPresence(socket: GameSocket, profileId: string): void {
  if (socket.data.profileId === profileId) return;
  if (socket.data.profileId) {
    markOffline(socket.data.profileId);
    socket.leave(perfilRoom(socket.data.profileId));
  }

  socket.data = { ...socket.data, profileId };
  markOnline(profileId);
  socket.join(perfilRoom(profileId));
}

/**
 * Item pago so vale se o jogador comprou. O cliente pode mandar qualquer
 * aparencia; aqui o que ele nao possui volta para o padrao.
 */
async function enforceOwnership(profile: PlayerProfile): Promise<PlayerProfile> {
  const paid = [
    paidItemFor("hat", profile.avatar.hat),
    paidItemFor("face", profile.avatar.face),
    paidItemFor("outfit", profile.avatar.outfit),
    paidItemFor("accent", profile.avatar.accent),
  ].filter((item) => item !== undefined);

  if (paid.length === 0) return profile;

  const owned = await getOwnedItems(profile.id);
  const avatar = { ...profile.avatar };

  for (const item of paid) {
    if (owned.has(item.id)) continue;
    if (item.kind === "hat") avatar.hat = DEFAULT_AVATAR.hat;
    else if (item.kind === "face") avatar.face = DEFAULT_AVATAR.face;
    else if (item.kind === "outfit") avatar.outfit = DEFAULT_AVATAR.outfit;
    else avatar.accent = DEFAULT_AVATAR.accent;
  }

  return { ...profile, avatar };
}

/**
 * O id canônico de quem está falando, sem exigir um perfil completo.
 *
 * A identidade mora na conexão, nunca no payload: logado, vem da sessão no
 * banco; convidado, vem do `socket.data.profileId` fixado no `identify`. Se o
 * cliente ainda não se identificou, não há ninguém — devolve null e cada
 * handler degrada de forma suave. Aceitar um id vindo do cliente deixaria
 * qualquer pessoa agir no lugar de outra, já que o `profileId` aparece no
 * ranking, nos desafios e na lista de amigos.
 */
async function resolvePlayerId(socket: GameSocket): Promise<string | null> {
  if (hasDatabase()) {
    const user = await userFromCookieHeader(socket.handshake.headers.cookie);
    if (user) {
      const owned = await getPlayerForUser(user.id);
      if (owned) return owned.id;
    }
  }

  return socket.data.profileId ?? null;
}

/**
 * Quantas pessoas estão com o jogo aberto, anunciado só quando o número muda.
 * O contador do engine ainda não decrementou no instante do disconnect, então
 * um reconciliador periódico garante que a queda apareça mesmo assim.
 */
/**
 * Quem está com o jogo aberto agora, por perfil. Uma pessoa pode ter várias
 * abas, então guardamos a contagem e o perfil só sai da lista quando a última
 * fecha.
 */
const onlineProfiles = new Map<string, number>();

function markOnline(profileId: string): void {
  onlineProfiles.set(profileId, (onlineProfiles.get(profileId) ?? 0) + 1);
}

function markOffline(profileId: string): void {
  const count = (onlineProfiles.get(profileId) ?? 0) - 1;
  if (count > 0) onlineProfiles.set(profileId, count);
  else onlineProfiles.delete(profileId);
}

function isOnline(profileId: string): boolean {
  return onlineProfiles.has(profileId);
}

let lastAnnounced = -1;

function announcePresence(): void {
  const online = io.engine.clientsCount;
  if (online === lastAnnounced) return;
  lastAnnounced = online;
  io.emit("presence", { online });
}

setInterval(announcePresence, 5000).unref?.();

io.on("connection", (socket: GameSocket) => {
  announcePresence();
  socket.on("disconnect", () => setTimeout(announcePresence, 250));

  socket.on("identify", (payload, ack) => {
    resolveProfile(socket, payload.profile)
      .then((resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });
        ack({
          ok: true,
          profile: resolved.profile,
          authenticated: resolved.authenticated,
          email: resolved.email,
        });
      })
      .catch((err) => fail(err, "identify", ack));
  });

  socket.on("createRoom", ({ profile }, ack) => {
    resolveProfile(socket, profile)
      .then((resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const { code, playerId } = rooms.createRoom(resolved.profile, socket.id);
        socket.data = { ...socket.data, playerId, roomCode: code };
        socket.join(code);
        ack({ ok: true, code, playerId });
        push(socket);
      })
      .catch((err) => fail(err, "createRoom", ack));
  });

  socket.on("createSolo", ({ profile, settings }, ack) => {
    resolveProfile(socket, profile)
      .then((resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const { code, playerId } = rooms.createSolo(resolved.profile, socket.id, settings);
        socket.data = { ...socket.data, playerId, roomCode: code };
        socket.join(code);
        ack({ ok: true, code, playerId });
        push(socket);
      })
      .catch((err) => fail(err, "createSolo", ack));
  });

  socket.on("createDuel", ({ profile, settings }, ack) => {
    resolveProfile(socket, profile)
      .then((resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const { code, playerId } = rooms.createDuel(resolved.profile, socket.id, settings);
        socket.data = { ...socket.data, playerId, roomCode: code };
        socket.join(code);
        ack({ ok: true, code, playerId });
        push(socket);
      })
      .catch((err) => fail(err, "createDuel", ack));
  });

  socket.on("createChallenge", ({ profile, settings }, ack) => {
    resolveProfile(socket, profile)
      .then(async (resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const result = await rooms.createChallengeRoom(resolved.profile, socket.id, settings);
        if (!result.ok) return ack(result);

        socket.data = { ...socket.data, playerId: result.playerId, roomCode: result.code };
        socket.join(result.code);
        ack(result);
        push(socket);
      })
      .catch((err) => fail(err, "createChallenge", ack));
  });

  socket.on("playChallenge", ({ profile, challengeCode }, ack) => {
    resolveProfile(socket, profile)
      .then(async (resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const result = await rooms.playChallenge(
          resolved.profile,
          socket.id,
          String(challengeCode ?? "").trim(),
        );
        if (!result.ok) return ack(result);

        socket.data = { ...socket.data, playerId: result.playerId, roomCode: result.code };
        socket.join(result.code);
        ack(result);
        push(socket);
      })
      .catch((err) => fail(err, "playChallenge", ack));
  });

  socket.on("joinRoom", ({ code, profile, playerId }, ack) => {
    resolveProfile(socket, profile)
      .then((resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const roomCode = String(code ?? "").trim().toUpperCase();
        const result = rooms.joinRoom(roomCode, resolved.profile, socket.id, playerId);
        if (!result.ok) return ack(result);

        socket.data = { ...socket.data, playerId: result.playerId, roomCode };
        socket.join(roomCode);
        ack({ ok: true, code: roomCode, playerId: result.playerId });

        const state = rooms.getState(roomCode);
        if (state) io.to(roomCode).emit("state", state);
      })
      .catch((err) => fail(err, "joinRoom", ack));
  });

  socket.on("fetchChallenge", ({ code }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Desafios precisam do banco configurado." });

    getChallengeSummary(String(code ?? "").trim())
      .then((challenge) =>
        ack(challenge ? { ok: true, challenge } : { ok: false, error: "Desafio não encontrado." }),
      )
      .catch((err) => fail(err, "fetchChallenge", ack));
  });

  socket.on("fetchStats", ({ profileId }, ack) => {
    if (!hasDatabase()) return ack({ stats: null });

    getStats(String(profileId ?? ""))
      .then((stats) => ack({ stats }))
      .catch((err) => {
        console.error("[fetchStats]", err);
        ack({ stats: null });
      });
  });

  socket.on("fetchFriends", ackOnly<"fetchFriends">((ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket)
      .then(async (playerId) => {
        if (!playerId) return ack({ ok: false, error: NAO_IDENTIFICADO });

        const myCode = await getFriendCode(playerId);
        const friends = await getFriends(playerId, isOnline);
        ack({ ok: true, myCode, friends });
      })
      .catch((err) => fail(err, "fetchFriends", ack));
  }));

  socket.on("addFriend", ({ code }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket)
      .then(async (playerId) => {
        if (!playerId) return ack({ ok: false, error: NAO_IDENTIFICADO });

        const result = await addFriendByCode(playerId, String(code ?? ""));
        if (!result.ok) return ack(result);
        ack({ ok: true, friends: await getFriends(playerId, isOnline) });
      })
      .catch((err) => fail(err, "addFriend", ack));
  });

  socket.on("convidarAmigo", ({ friendId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Convites precisam do banco configurado." });

    resolvePlayerId(socket)
      .then(async (playerId) => {
        // Quem convida é sempre a conexão. O payload só diz quem é o convidado,
        // e essa escolha ainda passa pela checagem de amizade no banco.
        if (!playerId) return ack({ ok: false, error: NAO_IDENTIFICADO });

        const alvo = String(friendId ?? "").trim();
        if (!alvo) return ack({ ok: false, error: "Escolha um amigo para chamar." });
        if (alvo === playerId) return ack({ ok: false, error: "Esse convite é para você mesmo." });

        const { roomCode, playerId: seatId } = socket.data;
        if (!roomCode || !seatId) {
          return ack({ ok: false, error: "Entre numa sala antes de chamar alguém." });
        }

        const state = rooms.getState(roomCode);
        if (!state) return ack({ ok: false, error: "Esta sala não existe mais." });
        if (state.phase !== "lobby") {
          return ack({ ok: false, error: "A partida já começou — não dá para entrar agora." });
        }
        if (state.players.length >= (state.mode === "duel" ? 2 : LOTACAO_MAXIMA)) {
          return ack({ ok: false, error: "A sala está cheia." });
        }

        if (!(await areFriends(playerId, alvo))) {
          return ack({ ok: false, error: "Você só pode chamar quem está na sua lista de amigos." });
        }
        if (!isOnline(alvo)) {
          return ack({ ok: false, error: "Esse amigo não está com o jogo aberto agora." });
        }

        const eu = state.players.find((p) => p.id === seatId);
        const convite: Convite = {
          deId: playerId,
          deNome: eu?.name ?? "Um amigo",
          deAvatar: eu?.avatar ?? { ...DEFAULT_AVATAR },
          roomCode: state.code,
          mode: state.mode,
          em: Date.now(),
        };

        // Chega em todas as abas da pessoa, não só na última que abriu.
        io.to(perfilRoom(alvo)).emit("convite", convite);
        ack({ ok: true });
      })
      .catch((err) => fail(err, "convidarAmigo", ack));
  });

  socket.on("removeFriend", ({ friendId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket)
      .then(async (playerId) => {
        if (!playerId) return ack({ ok: false, error: NAO_IDENTIFICADO });

        await removeFriend(playerId, String(friendId ?? ""));
        ack({ ok: true, friends: await getFriends(playerId, isOnline) });
      })
      .catch((err) => fail(err, "removeFriend", ack));
  });

  socket.on("fetchWallet", ackOnly<"fetchWallet">((ack) => {
    if (!hasDatabase()) return ack({ coins: 0, items: [] });

    resolvePlayerId(socket)
      // Sem identificação não há carteira para mostrar: devolve vazia.
      .then((playerId) => (playerId ? getWallet(playerId) : { coins: 0, items: [] }))
      .then((wallet) => ack(wallet))
      .catch((err) => {
        console.error("[fetchWallet]", err);
        ack({ coins: 0, items: [] });
      });
  }));

  socket.on("buyItem", ({ itemId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "A loja precisa do banco configurado." });

    resolvePlayerId(socket)
      .then((playerId) =>
        playerId ? buyItem(playerId, String(itemId ?? "")) : { ok: false as const, error: NAO_IDENTIFICADO },
      )
      .then((res) => {
        if (!res.ok) return ack(res);
        ack({ ok: true, coins: res.wallet.coins, items: res.wallet.items });
      })
      .catch((err) => fail(err, "buyItem", ack));
  });

  socket.on("fetchDaily", ackOnly<"fetchDaily">((ack) => {
    if (!hasDatabase()) {
      return ack({ ok: false, error: "O desafio do dia precisa do banco configurado." });
    }

    rooms
      .ensureDaily()
      .then(async (daily) => {
        if (!daily) {
          return ack({
            ok: false,
            error: "Não consegui sortear o desafio de hoje. Confira a chave do Maps e a cota da API.",
          });
        }

        const summary = await getChallengeSummary(daily.code);
        if (!summary) return ack({ ok: false, error: "Desafio de hoje indisponível." });

        const playerId = await resolvePlayerId(socket);
        const mine = playerId
          ? summary.entries.find((entry) => entry.profileId === playerId)
          : undefined;

        ack({
          ok: true,
          daily: {
            day: daily.day,
            challengeCode: daily.code,
            rounds: summary.rounds,
            resetsAt: nextDailyResetAt(),
            alreadyPlayed: !!mine,
            myScore: mine?.totalScore ?? null,
            topEntries: summary.entries.slice(0, 5),
          },
        });
      })
      .catch((err) => fail(err, "fetchDaily", ack));
  }));

  socket.on("playDaily", ({ profile }, ack) => {
    resolveProfile(socket, profile)
      .then(async (resolved) => {
        if (!resolved) return ack({ ok: false, error: "Escolha um apelido." });

        const daily = await rooms.ensureDaily();
        if (!daily) {
          return ack({ ok: false, error: "O desafio de hoje ainda não está disponível." });
        }

        const result = await rooms.playChallenge(resolved.profile, socket.id, daily.code);
        if (!result.ok) return ack(result);

        socket.data = { ...socket.data, playerId: result.playerId, roomCode: result.code };
        socket.join(result.code);
        ack(result);
        push(socket);
      })
      .catch((err) => fail(err, "playDaily", ack));
  });

  socket.on("fetchLeaderboards", (ack) => {
    if (!hasDatabase()) return ack({ leaderboards: { solo: [], streaks: [] } });

    getLeaderboards()
      .then((leaderboards) => ack({ leaderboards }))
      .catch((err) => {
        console.error("[fetchLeaderboards]", err);
        ack({ leaderboards: { solo: [], streaks: [] } });
      });
  });

  socket.on("enviarChat", (payload, ack) => {
    // Uma aba antiga (ou um script) pode emitir sem ack: sem ele não há a quem
    // responder, e chamar `ack` derrubaria a conexão.
    if (typeof ack !== "function") return;

    // Quem fala é a conexão. O payload traz só o texto — nome, avatar e sala
    // saem do assento, senão um payload forjado falaria no lugar de outra pessoa.
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) {
      return ack({ ok: false, error: "Entre numa sala para conversar." });
    }

    const state = rooms.getState(roomCode);
    if (!state) return ack({ ok: false, error: "Esta sala não existe mais." });

    const eu = state.players.find((p) => p.id === playerId);
    if (!eu) return ack({ ok: false, error: "Você não está mais nesta sala." });

    const text = limpaFala(payload?.text);
    if (!text) return ack({ ok: false, error: "Escreva algo antes de enviar." });

    const agora = Date.now();
    if (agora - (socket.data.ultimaFala ?? 0) < INTERVALO_FALA_MS) {
      return ack({ ok: false, error: "Calma — espere um instante para falar de novo." });
    }
    socket.data = { ...socket.data, ultimaFala: agora };

    falasEmitidas += 1;
    const fala: ChatMessage = {
      id: `${socket.id}-${agora}-${falasEmitidas}`,
      playerId: eu.id,
      playerName: eu.name,
      avatar: eu.avatar,
      text,
      em: agora,
    };

    // Só para esta sala: chat de sala não é mural do jogo inteiro.
    io.to(roomCode).emit("chat", fala);
    ack({ ok: true });
  });

  socket.on("updateSettings", ({ settings }) => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) rooms.updateSettings(roomCode, playerId, settings ?? {});
  });

  socket.on("startGame", () => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) {
      rooms.startGame(roomCode, playerId).catch((err) => console.error("[startGame]", err));
    }
  });

  socket.on("submitGuess", ({ position }) => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) rooms.submitGuess(roomCode, playerId, position);
  });

  socket.on("nextRound", () => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) {
      rooms.nextRound(roomCode, playerId).catch((err) => console.error("[nextRound]", err));
    }
  });

  socket.on("playAgain", () => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) rooms.playAgain(roomCode, playerId);
  });

  socket.on("leaveRoom", () => {
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) {
      rooms.leaveRoom(roomCode, playerId);
      socket.leave(roomCode);
      // Sai da sala mas continua sendo a mesma pessoa nesta conexão.
      socket.data = { profileId: socket.data.profileId };
    }
  });

  socket.on("disconnect", () => {
    const { roomCode, playerId, profileId } = socket.data;
    if (roomCode && playerId) rooms.handleDisconnect(roomCode, playerId);
    if (profileId) markOffline(profileId);
  });
});

httpServer.listen(port, hostname, () => {
  console.log(`> BlindGuess pronto em http://${hostname}:${port}`);
  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    console.warn("! NEXT_PUBLIC_GOOGLE_MAPS_API_KEY não definida — copie .env.example para .env");
  }
});

/** Serve só para dar id único a cada fala dentro deste processo. */
let falasEmitidas = 0;

/**
 * Deixa a fala pronta para ir ao ar: sem quebras de linha nem espaço sobrando e
 * cortada no limite. O corte é feito aqui porque o `maxLength` do input é só
 * conveniência — quem emite direto pelo socket não passa por ele.
 */
function limpaFala(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_CHARS);
}

function sanitizeName(name: unknown): string {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

const HATS = new Set([
  "none", "cap", "explorer", "beanie", "headphones",
  "bucket", "visor", "helmet", "crown",
]);
const FACES = new Set([
  "smile", "focused", "glasses", "shades", "wink", "grin", "eyepatch",
]);

/** So aceita cores em hex e opcoes conhecidas — nada vindo do cliente entra cru na UI. */
function sanitizeColor(value: unknown, fallback: string): string {
  const raw = String(value ?? "");
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function sanitizeProfile(profile: unknown): PlayerProfile | null {
  const input = (profile ?? {}) as Partial<PlayerProfile>;
  const name = sanitizeName(input.name);
  if (!name) return null;

  const id = String(input.id ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!id) return null;

  const raw = (input.avatar ?? {}) as Partial<Avatar>;
  const avatar: Avatar = {
    skin: sanitizeColor(raw.skin, DEFAULT_AVATAR.skin),
    outfit: sanitizeColor(raw.outfit, DEFAULT_AVATAR.outfit),
    accent: sanitizeColor(raw.accent, DEFAULT_AVATAR.accent),
    hat: HATS.has(String(raw.hat)) ? (raw.hat as Avatar["hat"]) : DEFAULT_AVATAR.hat,
    face: FACES.has(String(raw.face)) ? (raw.face as Avatar["face"]) : DEFAULT_AVATAR.face,
  };

  return { id, name, avatar };
}

// Fecha as conexões do banco antes de sair, num deploy ou restart.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const done = () => process.exit(0);
    if (hasDatabase()) getPool().end().then(done, done);
    else done();
  });
}
