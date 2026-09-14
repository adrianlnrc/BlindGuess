import { haversineMeters, scoreForDistance } from "@/lib/scoring";
import {
  DEFAULT_SETTINGS,
  type Guess,
  type LatLng,
  type Player,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  type RoundResult,
} from "@/lib/types";
import { pickLocation, type PickedLocation } from "./locations";

type InternalPlayer = Player & { socketId: string | null };

type Room = {
  code: string;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: Map<string, InternalPlayer>;
  round: number;
  /** Alvo da rodada atual — nunca vai para o cliente antes do fim da rodada. */
  target: PickedLocation | null;
  usedPanos: Set<string>;
  guesses: Map<string, Guess>;
  roundEndsAt: number | null;
  timer: NodeJS.Timeout | null;
  lastResult: RoundResult | null;
  error?: string;
  /** Ultima interacao, usada para limpar salas abandonadas. */
  touchedAt: number;
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 12;
/** Folga para o tempo de rede antes do servidor fechar a rodada. */
const TIMER_GRACE_MS = 1500;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private broadcast: (code: string) => void) {
    setInterval(() => this.cleanup(), 15 * 60 * 1000).unref?.();
  }

  // ---------------------------------------------------------------- salas

  createRoom(hostName: string, socketId: string): { code: string; playerId: string } {
    const code = this.generateCode();
    const playerId = randomId();

    const room: Room = {
      code,
      hostId: playerId,
      phase: "lobby",
      settings: { ...DEFAULT_SETTINGS },
      players: new Map([
        [playerId, { id: playerId, name: hostName, isHost: true, connected: true, totalScore: 0, socketId }],
      ]),
      round: 0,
      target: null,
      usedPanos: new Set(),
      guesses: new Map(),
      roundEndsAt: null,
      timer: null,
      lastResult: null,
      touchedAt: Date.now(),
    };

    this.rooms.set(code, room);
    return { code, playerId };
  }

  joinRoom(
    code: string,
    name: string,
    socketId: string,
    existingPlayerId?: string,
  ): { ok: true; playerId: string } | { ok: false; error: string } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { ok: false, error: "Sala não encontrada." };

    room.touchedAt = Date.now();

    // Reconexao: mesmo jogador voltando (refresh, queda de rede).
    if (existingPlayerId) {
      const existing = room.players.get(existingPlayerId);
      if (existing) {
        existing.connected = true;
        existing.socketId = socketId;
        existing.name = name || existing.name;
        return { ok: true, playerId: existing.id };
      }
    }

    if (room.phase !== "lobby") return { ok: false, error: "A partida já começou." };
    if (room.players.size >= MAX_PLAYERS) return { ok: false, error: "A sala está cheia." };

    const playerId = randomId();
    room.players.set(playerId, {
      id: playerId,
      name,
      isHost: false,
      connected: true,
      totalScore: 0,
      socketId,
    });
    return { ok: true, playerId };
  }

  leaveRoom(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    room.players.delete(playerId);

    if (room.players.size === 0) {
      this.destroy(room);
      return;
    }

    if (room.hostId === playerId) this.promoteNewHost(room);
    if (room.phase === "playing") this.maybeFinishRound(room);
    this.broadcast(code);
  }

  handleDisconnect(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    const player = room?.players.get(playerId);
    if (!room || !player) return;

    player.connected = false;
    player.socketId = null;

    // No lobby ninguem fica preso a uma sala: quem cai, sai.
    if (room.phase === "lobby") {
      room.players.delete(playerId);
      if (room.players.size === 0) {
        this.destroy(room);
        return;
      }
      if (room.hostId === playerId) this.promoteNewHost(room);
    } else if (room.hostId === playerId) {
      this.promoteNewHost(room);
    }

    if (room.phase === "playing") this.maybeFinishRound(room);
    this.broadcast(code);
  }

  // ------------------------------------------------------------- partida

  updateSettings(code: string, playerId: string, patch: Partial<RoomSettings>): void {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "lobby") return;

    const next = { ...room.settings, ...patch };
    room.settings = {
      ...next,
      rounds: clamp(Math.round(next.rounds), 1, 20),
      roundSeconds: clamp(Math.round(next.roundSeconds), 0, 600),
    };
    room.touchedAt = Date.now();
    this.broadcast(code);
  }

  async startGame(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "lobby") return;

    for (const player of room.players.values()) player.totalScore = 0;
    room.round = 0;
    room.usedPanos.clear();
    room.lastResult = null;

    await this.beginRound(room);
  }

  async nextRound(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "round-result") return;

    if (room.round >= room.settings.rounds) {
      room.phase = "finished";
      this.broadcast(code);
      return;
    }

    await this.beginRound(room);
  }

  playAgain(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId) return;

    this.clearTimer(room);
    room.phase = "lobby";
    room.round = 0;
    room.target = null;
    room.guesses.clear();
    room.usedPanos.clear();
    room.lastResult = null;
    room.roundEndsAt = null;
    room.error = undefined;
    for (const player of room.players.values()) player.totalScore = 0;

    this.broadcast(code);
  }

  submitGuess(code: string, playerId: string, position: LatLng): void {
    const room = this.rooms.get(code);
    if (!room || room.phase !== "playing" || !room.target) return;
    if (!room.players.has(playerId) || room.guesses.has(playerId)) return;
    if (!isValidLatLng(position)) return;

    const player = room.players.get(playerId)!;
    const distanceMeters = haversineMeters(position, room.target);

    room.guesses.set(playerId, {
      playerId,
      playerName: player.name,
      position,
      distanceMeters,
      score: scoreForDistance(distanceMeters),
    });

    room.touchedAt = Date.now();
    this.maybeFinishRound(room);
    this.broadcast(code);
  }

  private async beginRound(room: Room): Promise<void> {
    this.clearTimer(room);
    room.guesses.clear();
    room.error = undefined;
    room.target = null;
    room.roundEndsAt = null;
    room.phase = "playing";
    room.round += 1;
    room.touchedAt = Date.now();
    // Mostra "carregando" enquanto a API procura um panorama.
    this.broadcast(room.code);

    const location = await pickLocation(room.settings.region, 12, room.usedPanos);

    if (!location) {
      room.phase = room.round > 1 ? "round-result" : "lobby";
      room.round = Math.max(0, room.round - 1);
      room.error =
        "Não consegui carregar um local do Street View. Confira a GOOGLE_MAPS_API_KEY e a cota da API.";
      this.broadcast(room.code);
      return;
    }

    room.target = location;
    room.usedPanos.add(location.panoId);

    if (room.settings.roundSeconds > 0) {
      room.roundEndsAt = Date.now() + room.settings.roundSeconds * 1000;
      room.timer = setTimeout(
        () => this.finishRound(room),
        room.settings.roundSeconds * 1000 + TIMER_GRACE_MS,
      );
    }

    this.broadcast(room.code);
  }

  /** Fecha a rodada assim que todos os conectados ja palpitaram. */
  private maybeFinishRound(room: Room): void {
    const active = [...room.players.values()].filter((p) => p.connected);
    if (active.length === 0) return;
    if (active.every((p) => room.guesses.has(p.id))) this.finishRound(room);
  }

  private finishRound(room: Room): void {
    if (room.phase !== "playing" || !room.target) return;

    this.clearTimer(room);
    room.phase = "round-result";
    room.roundEndsAt = null;

    const guesses = [...room.guesses.values()].sort((a, b) => b.score - a.score);
    for (const guess of guesses) {
      const player = room.players.get(guess.playerId);
      if (player) player.totalScore += guess.score;
    }

    room.lastResult = { round: room.round, target: { ...room.target }, guesses };
    room.target = null;
    room.touchedAt = Date.now();

    this.broadcast(room.code);
  }

  // -------------------------------------------------------------- estado

  getState(code: string): RoomState | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    return {
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      players: [...room.players.values()]
        .map((player): Player => ({
          id: player.id,
          name: player.name,
          isHost: player.isHost,
          connected: player.connected,
          totalScore: player.totalScore,
        }))
        .sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name)),
      round: room.round,
      panorama: room.phase === "playing" && room.target ? { panoId: room.target.panoId } : null,
      roundEndsAt: room.roundEndsAt,
      submitted: [...room.guesses.keys()],
      lastResult: room.lastResult,
      error: room.error,
    };
  }

  hasRoom(code: string): boolean {
    return this.rooms.has(code);
  }

  // ------------------------------------------------------------ internos

  private promoteNewHost(room: Room): void {
    const next =
      [...room.players.values()].find((p) => p.connected) ?? [...room.players.values()][0];
    if (!next) return;

    for (const player of room.players.values()) player.isHost = false;
    next.isHost = true;
    room.hostId = next.id;
  }

  private clearTimer(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }

  private destroy(room: Room): void {
    this.clearTimer(room);
    this.rooms.delete(room.code);
  }

  private generateCode(): string {
    let code = "";
    do {
      code = Array.from(
        { length: 5 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.rooms.has(code));
    return code;
  }

  private cleanup(): void {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const room of this.rooms.values()) {
      if (room.touchedAt < cutoff) this.destroy(room);
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isValidLatLng(p: LatLng): boolean {
  return (
    typeof p?.lat === "number" &&
    typeof p?.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
