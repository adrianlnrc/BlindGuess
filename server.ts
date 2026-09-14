import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer, type Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/lib/types.ts";
import { RoomManager } from "./src/server/rooms.ts";

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
  socket.on("createRoom", ({ name }, ack) => {
    const nickname = sanitizeName(name);
    if (!nickname) return ack({ ok: false, error: "Escolha um apelido." });

    const { code, playerId } = rooms.createRoom(nickname, socket.id);
    socket.data = { playerId, roomCode: code };
    socket.join(code);
    ack({ ok: true, code, playerId });
    push(socket);
  });

  socket.on("joinRoom", ({ code, name, playerId }, ack) => {
    const nickname = sanitizeName(name);
    if (!nickname) return ack({ ok: false, error: "Escolha um apelido." });

    const roomCode = String(code ?? "").trim().toUpperCase();
    const result = rooms.joinRoom(roomCode, nickname, socket.id, playerId);
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
