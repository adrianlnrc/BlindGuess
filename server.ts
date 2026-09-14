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
import { RoomManager } from "./src/server/rooms.ts";
import {
  flushNow,
  getChallengeSummary,
  getLeaderboards,
  getStats,
  saveProfile,
} from "./src/server/store.ts";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

type SocketData = { playerId?: string; roomCode?: string };
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

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

io.on("connection", (socket: GameSocket) => {
  socket.on("createRoom", ({ profile }, ack) => {
    const clean = sanitizeProfile(profile);
    if (!clean) return ack({ ok: false, error: "Escolha um apelido." });

    saveProfile(clean);
    const { code, playerId } = rooms.createRoom(clean, socket.id);
    socket.data = { playerId, roomCode: code };
    socket.join(code);
    ack({ ok: true, code, playerId });
    push(socket);
  });

  socket.on("createSolo", ({ profile, settings }, ack) => {
    const clean = sanitizeProfile(profile);
    if (!clean) return ack({ ok: false, error: "Escolha um apelido." });

    saveProfile(clean);
    const { code, playerId } = rooms.createSolo(clean, socket.id, settings);
    socket.data = { playerId, roomCode: code };
    socket.join(code);
    ack({ ok: true, code, playerId });
    push(socket);
  });

  socket.on("createChallenge", ({ profile, settings }, ack) => {
    const clean = sanitizeProfile(profile);
    if (!clean) return ack({ ok: false, error: "Escolha um apelido." });

    saveProfile(clean);
    rooms
      .createChallengeRoom(clean, socket.id, settings)
      .then((result) => {
        if (!result.ok) return ack(result);

        socket.data = { playerId: result.playerId, roomCode: result.code };
        socket.join(result.code);
        ack(result);
        push(socket);
      })
      .catch((err) => {
        console.error("[createChallenge]", err);
        ack({ ok: false, error: "Não consegui criar o desafio agora." });
      });
  });

  socket.on("playChallenge", ({ profile, challengeCode }, ack) => {
    const clean = sanitizeProfile(profile);
    if (!clean) return ack({ ok: false, error: "Escolha um apelido." });

    saveProfile(clean);
    const result = rooms.playChallenge(clean, socket.id, String(challengeCode ?? "").trim());
    if (!result.ok) return ack(result);

    socket.data = { playerId: result.playerId, roomCode: result.code };
    socket.join(result.code);
    ack(result);
    push(socket);
  });

  socket.on("fetchChallenge", ({ code }, ack) => {
    const challenge = getChallengeSummary(String(code ?? "").trim());
    ack(challenge ? { ok: true, challenge } : { ok: false, error: "Desafio não encontrado." });
  });

  socket.on("fetchStats", ({ profileId }, ack) => {
    ack({ stats: getStats(String(profileId ?? "")) });
  });

  socket.on("fetchLeaderboards", (ack) => {
    ack({ leaderboards: getLeaderboards() });
  });

  socket.on("joinRoom", ({ code, profile, playerId }, ack) => {
    const clean = sanitizeProfile(profile);
    if (!clean) return ack({ ok: false, error: "Escolha um apelido." });

    saveProfile(clean);
    const roomCode = String(code ?? "").trim().toUpperCase();
    const result = rooms.joinRoom(roomCode, clean, socket.id, playerId);
    if (!result.ok) return ack(result);

    socket.data = { playerId: result.playerId, roomCode };
    socket.join(roomCode);
    ack({ ok: true, code: roomCode, playerId: result.playerId });

    const state = rooms.getState(roomCode);
    if (state) io.to(roomCode).emit("state", state);
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
    const { roomCode, playerId } = socket.data;
    if (roomCode && playerId) rooms.handleDisconnect(roomCode, playerId);
  });
});

httpServer.listen(port, hostname, () => {
  console.log(`> BlindGuess pronto em http://${hostname}:${port}`);
  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    console.warn("! NEXT_PUBLIC_GOOGLE_MAPS_API_KEY nao definida — copie .env.example para .env");
  }
});

function sanitizeName(name: unknown): string {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

const HATS = new Set(["none", "cap", "explorer", "beanie", "headphones"]);
const FACES = new Set(["smile", "focused", "glasses", "shades"]);

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

// Garante que nada em memoria se perca num deploy/restart limpo.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    flushNow();
    process.exit(0);
  });
}
