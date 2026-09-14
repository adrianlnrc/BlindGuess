"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./types";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/** Conexao unica compartilhada por toda a aplicacao. */
export function getSocket(): GameSocket {
  if (!socket) {
    socket = io({ path: "/api/socket", transports: ["websocket", "polling"] });
  }
  return socket;
}

const PLAYER_KEY = "blindguess:playerId";

export function storedPlayerId(code: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(`${PLAYER_KEY}:${code}`) ?? undefined;
}

export function rememberPlayer(code: string, playerId: string): void {
  window.localStorage.setItem(`${PLAYER_KEY}:${code}`, playerId);
}
