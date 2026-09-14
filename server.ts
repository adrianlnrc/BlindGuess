import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer, type Socket } from "socket.io";
import {
  DEFAULT_AVATAR,
  type Avatar,
  type ClientToServerEvents,
  type PlayerProfile,
  type ServerToClientEvents,
} from "./src/lib/types.ts";
import { getPool, hasDatabase, migrate } from "./src/server/db.ts";
import { RoomManager } from "./src/server/rooms.ts";
import { userFromCookieHeader } from "./src/server/session.ts";
import { paidItemFor } from "./src/lib/shop.ts";
import {
  addFriendByCode,
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

type SocketData = { playerId?: string; roomCode?: string; profileId?: string };
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

/** Amarra a presença do perfil a esta conexão, trocando se a identidade mudar. */
function trackPresence(socket: GameSocket, profileId: string): void {
  if (socket.data.profileId === profileId) return;
  if (socket.data.profileId) markOffline(socket.data.profileId);

  socket.data = { ...socket.data, profileId };
  markOnline(profileId);
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

/** O id canônico de quem está falando, sem exigir um perfil completo. */
async function resolvePlayerId(socket: GameSocket, fallback: unknown): Promise<string> {
  const given = String(fallback ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!hasDatabase()) return given;

  const user = await userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return given;

  const owned = await getPlayerForUser(user.id);
  return owned?.id ?? given;
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
        socket.data = { playerId, roomCode: code };
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
        socket.data = { playerId, roomCode: code };
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
        socket.data = { playerId, roomCode: code };
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

        socket.data = { playerId: result.playerId, roomCode: result.code };
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

        socket.data = { playerId: result.playerId, roomCode: result.code };
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

        socket.data = { playerId: result.playerId, roomCode };
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

  socket.on("fetchFriends", ({ profileId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket, profileId)
      .then(async (playerId) => {
        const myCode = await getFriendCode(playerId);
        const friends = await getFriends(playerId, isOnline);
        ack({ ok: true, myCode, friends });
      })
      .catch((err) => fail(err, "fetchFriends", ack));
  });

  socket.on("addFriend", ({ profileId, code }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket, profileId)
      .then(async (playerId) => {
        const result = await addFriendByCode(playerId, String(code ?? ""));
        if (!result.ok) return ack(result);
        ack({ ok: true, friends: await getFriends(playerId, isOnline) });
      })
      .catch((err) => fail(err, "addFriend", ack));
  });

  socket.on("removeFriend", ({ profileId, friendId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "Amigos precisam do banco configurado." });

    resolvePlayerId(socket, profileId)
      .then(async (playerId) => {
        await removeFriend(playerId, String(friendId ?? ""));
        ack({ ok: true, friends: await getFriends(playerId, isOnline) });
      })
      .catch((err) => fail(err, "removeFriend", ack));
  });

  socket.on("fetchWallet", ({ profileId }, ack) => {
    if (!hasDatabase()) return ack({ coins: 0, items: [] });

    resolvePlayerId(socket, profileId)
      .then((playerId) => getWallet(playerId))
      .then((wallet) => ack(wallet))
      .catch((err) => {
        console.error("[fetchWallet]", err);
        ack({ coins: 0, items: [] });
      });
  });

  socket.on("buyItem", ({ profileId, itemId }, ack) => {
    if (!hasDatabase()) return ack({ ok: false, error: "A loja precisa do banco configurado." });

    resolvePlayerId(socket, profileId)
      .then((playerId) => buyItem(playerId, String(itemId ?? "")))
      .then((res) => {
        if (!res.ok) return ack(res);
        ack({ ok: true, coins: res.wallet.coins, items: res.wallet.items });
      })
      .catch((err) => fail(err, "buyItem", ack));
  });

  socket.on("fetchDaily", ({ profileId }, ack) => {
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

        const playerId = await resolvePlayerId(socket, profileId);
        const mine = summary.entries.find((entry) => entry.profileId === playerId);

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
  });

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

        socket.data = { playerId: result.playerId, roomCode: result.code };
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
      socket.data = {};
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
