import { DUEL_MAX_ROUNDS, DUEL_START_HP, damageFor, duelMultiplier } from "@/lib/duel";
import { haversineMeters, scoreForDistance } from "@/lib/scoring";
import {
  DEFAULT_AVATAR,
  DEFAULT_SETTINGS,
  type Guess,
  type LatLng,
  type Player,
  type RoomPhase,
  type RoomSettings,
  type GameMode,
  type PlayerProfile,
  type RoomState,
  type RoundResult,
  type LocationSearch,
} from "@/lib/types";
import { pickLocation, type PickedLocation } from "./locations";
import {
  createChallenge,
  getChallenge,
  getDailyCode,
  hasPlayedChallenge,
  recordGame,
  setDailyCode,
  today,
} from "./store";

type InternalPlayer = Player & { socketId: string | null; profile: PlayerProfile };

type Room = {
  code: string;
  mode: GameMode;
  hostId: string;
  phase: RoomPhase;
  /** Locais pre-sorteados (modo desafio); null = sorteia a cada rodada. */
  fixedLocations: PickedLocation[] | null;
  /** Desafio que esta sala esta jogando. */
  challengeCode: string | null;
  challengeCreatorName: string | null;
  /** Desafio gerado a partir desta partida, para compartilhar no fim. */
  sharedChallengeCode: string | null;
  /** Locais ja usados na partida, para virar desafio depois. */
  playedLocations: PickedLocation[];
  /** Evita gravar a mesma partida duas vezes no store. */
  recorded: boolean;
  /** Vida de cada jogador no duelo. */
  hp: Map<string, number>;
  duelWinnerId: string | null;
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
  /** Progresso da busca pelo local, enquanto ela acontece. */
  search: LocationSearch | null;
  /** O sorteio do local desistiu: da para tentar a mesma rodada de novo. */
  canRetryRound: boolean;
  /** Ultima interacao, usada para limpar salas abandonadas. */
  touchedAt: number;
};

/** O desafio do dia é igual para todo mundo, então a configuração é fixa. */
export const DAILY_SETTINGS: RoomSettings = {
  rounds: 5,
  roundSeconds: 120,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

/** Autor do desafio do dia, para ele não aparecer como criação de um jogador. */
const DAILY_AUTHOR: PlayerProfile = {
  id: "desafio-do-dia",
  name: "Desafio do dia",
  avatar: { ...DEFAULT_AVATAR, outfit: "#ffb454", accent: "#35d6a4", hat: "explorer" },
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 12;
/** Folga para o tempo de rede antes do servidor fechar a rodada. */
const TIMER_GRACE_MS = 1500;
/** Quantas vezes tentamos sortear o local antes de desistir da rodada. */
const LOCATION_ATTEMPTS = 3;
/** Espera crescente entre as tentativas de sorteio (ms). */
const LOCATION_RETRY_DELAYS_MS = [400, 1000, 2000];
/** Texto unico de falha, com o que vale a pena conferir. */
const LOCATION_ERROR =
  "Não consegui carregar um local do Street View depois de várias tentativas. " +
  "Confira a GOOGLE_MAPS_API_KEY e a cota da API do Maps — o placar está guardado, dá para tentar de novo.";

/** Pontos de injecao usados nos testes; em producao valem os padroes. */
export type RoomManagerOptions = {
  /** Sorteio do local; trocado nos testes para nao depender da API do Maps. */
  pickLocation?: typeof pickLocation;
  /** Espera entre as tentativas de sorteio, em ms. */
  retryDelaysMs?: number[];
};

export class RoomManager {
  private rooms = new Map<string, Room>();
  private pickLocation: typeof pickLocation;
  private retryDelays: number[];

  constructor(
    private broadcast: (code: string) => void,
    options: RoomManagerOptions = {},
  ) {
    this.pickLocation = options.pickLocation ?? pickLocation;
    this.retryDelays = options.retryDelaysMs ?? LOCATION_RETRY_DELAYS_MS;
    setInterval(() => this.cleanup(), 15 * 60 * 1000).unref?.();
  }

  // ---------------------------------------------------------------- salas

  createRoom(
    profile: PlayerProfile,
    socketId: string,
    options: {
      mode?: GameMode;
      settings?: Partial<RoomSettings>;
      fixedLocations?: PickedLocation[];
      challengeCode?: string;
      challengeCreatorName?: string;
    } = {},
  ): { code: string; playerId: string } {
    const code = this.generateCode();
    const playerId = randomId();

    const room: Room = {
      code,
      mode: options.mode ?? "party",
      hostId: playerId,
      phase: "lobby",
      fixedLocations: options.fixedLocations ?? null,
      challengeCode: options.challengeCode ?? null,
      challengeCreatorName: options.challengeCreatorName ?? null,
      sharedChallengeCode: null,
      playedLocations: [],
      recorded: false,
      hp: new Map(),
      duelWinnerId: null,
      settings: sanitizeSettings({ ...DEFAULT_SETTINGS, ...options.settings }),
      players: new Map([
        [
          playerId,
          {
            id: playerId,
            name: profile.name,
            avatar: profile.avatar,
            isHost: true,
            connected: true,
            totalScore: 0,
            socketId,
            profile,
          },
        ],
      ]),
      round: 0,
      target: null,
      usedPanos: new Set(),
      guesses: new Map(),
      roundEndsAt: null,
      timer: null,
      lastResult: null,
      search: null,
      canRetryRound: false,
      touchedAt: Date.now(),
    };

    this.rooms.set(code, room);
    return { code, playerId };
  }

  joinRoom(
    code: string,
    profile: PlayerProfile,
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
        existing.name = profile.name || existing.name;
        existing.avatar = profile.avatar;
        existing.profile = profile;
        return { ok: true, playerId: existing.id };
      }
    }

    if (room.mode === "solo" || room.mode === "challenge") {
      return { ok: false, error: "Esta sala é de um jogador só." };
    }
    if (room.phase !== "lobby") return { ok: false, error: "A partida já começou." };

    const limit = room.mode === "duel" ? 2 : MAX_PLAYERS;
    if (room.players.size >= limit) {
      return { ok: false, error: room.mode === "duel" ? "O duelo já tem dois jogadores." : "A sala está cheia." };
    }

    const playerId = randomId();
    room.players.set(playerId, {
      id: playerId,
      name: profile.name,
      avatar: profile.avatar,
      isHost: false,
      connected: true,
      totalScore: 0,
      socketId,
      profile,
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

  /** Sala de um jogador so; o proprio jogador e o anfitriao. */
  createSolo(
    profile: PlayerProfile,
    socketId: string,
    settings?: Partial<RoomSettings>,
  ): { code: string; playerId: string } {
    return this.createRoom(profile, socketId, { mode: "solo", settings });
  }

  /**
   * Sorteia todos os locais de uma vez, guarda como desafio e abre a sala do
   * criador. Assim todo mundo que jogar o link ve exatamente os mesmos lugares.
   */
  async createChallengeRoom(
    profile: PlayerProfile,
    socketId: string,
    settings?: Partial<RoomSettings>,
  ): Promise<{ ok: true; code: string; playerId: string; challengeCode: string } | { ok: false; error: string }> {
    const finalSettings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    const locations = await this.prepareLocations(finalSettings);

    if (!locations) {
      return {
        ok: false,
        error: "Não consegui sortear os locais do desafio. Confira a GOOGLE_MAPS_API_KEY e a cota da API.",
      };
    }

    const challengeCode = await createChallenge({
      creator: profile,
      settings: finalSettings,
      locations,
    });
    const { code, playerId } = this.createRoom(profile, socketId, {
      mode: "challenge",
      settings: finalSettings,
      fixedLocations: locations,
      challengeCode,
      challengeCreatorName: profile.name,
    });

    return { ok: true, code, playerId, challengeCode };
  }

  /** Sala de duelo 1v1; o adversario entra pelo codigo. */
  createDuel(
    profile: PlayerProfile,
    socketId: string,
    settings?: Partial<RoomSettings>,
  ): { code: string; playerId: string } {
    return this.createRoom(profile, socketId, {
      mode: "duel",
      // No duelo quem decide o fim e a vida, nao a contagem de rodadas.
      settings: { ...settings, rounds: DUEL_MAX_ROUNDS },
    });
  }

  /**
   * Devolve o desafio de hoje, sorteando os locais na primeira vez que alguem
   * pede no dia. Se dois jogadores pedirem ao mesmo tempo, o banco decide qual
   * vale e os dois jogam o mesmo.
   */
  async ensureDaily(): Promise<{ code: string; day: string } | null> {
    const day = today();

    const existing = await getDailyCode(day);
    if (existing) return { code: existing, day };

    const locations = await this.prepareLocations(DAILY_SETTINGS);
    if (!locations) return null;

    const code = await createChallenge({
      creator: DAILY_AUTHOR,
      settings: DAILY_SETTINGS,
      locations,
      singleAttempt: true,
    });

    return { code: await setDailyCode(day, code), day };
  }

  /** Abre uma sala com os locais exatos de um desafio ja existente. */
  async playChallenge(
    profile: PlayerProfile,
    socketId: string,
    challengeCode: string,
  ): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
    const challenge = await getChallenge(challengeCode);
    if (!challenge) return { ok: false, error: "Desafio não encontrado." };

    // Desafio do dia: uma tentativa por pessoa, sem repetir para melhorar.
    if (challenge.singleAttempt && (await hasPlayedChallenge(challenge.code, profile.id))) {
      return { ok: false, error: "Você já jogou o desafio de hoje. Volte amanhã." };
    }

    const { code, playerId } = this.createRoom(profile, socketId, {
      mode: "challenge",
      settings: challenge.settings,
      fixedLocations: challenge.locations,
      challengeCode: challenge.code,
      challengeCreatorName: challenge.creatorName,
    });

    return { ok: true, code, playerId };
  }

  /** Sorteia N locais distintos para um desafio. */
  private async prepareLocations(settings: RoomSettings): Promise<PickedLocation[] | null> {
    const locations: PickedLocation[] = [];
    const used = new Set<string>();

    for (let i = 0; i < settings.rounds; i++) {
      const location = await this.pickLocation(settings.region, 12, used);
      if (!location) return null;
      used.add(location.panoId);
      locations.push(location);
    }

    return locations;
  }

  // ------------------------------------------------------------- partida

  updateSettings(code: string, playerId: string, patch: Partial<RoomSettings>): void {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "lobby") return;
    // Num desafio os locais ja estao fixados: mudar regiao ou rodadas quebraria a comparacao.
    if (room.fixedLocations) return;

    room.settings = sanitizeSettings({ ...room.settings, ...patch });
    room.touchedAt = Date.now();
    this.broadcast(code);
  }

  async startGame(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "lobby") return;

    if (room.mode === "duel" && room.players.size !== 2) {
      room.error = "O duelo precisa de exatamente dois jogadores.";
      this.broadcast(code);
      return;
    }

    for (const player of room.players.values()) player.totalScore = 0;
    room.round = 0;
    room.usedPanos.clear();
    room.lastResult = null;
    room.playedLocations = [];
    room.sharedChallengeCode = null;
    room.recorded = false;
    room.duelWinnerId = null;

    room.hp.clear();
    if (room.mode === "duel") {
      for (const player of room.players.values()) room.hp.set(player.id, DUEL_START_HP);
    }

    await this.beginRound(room);
  }

  async nextRound(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "round-result") return;

    if (room.mode === "duel") {
      if (room.duelWinnerId) {
        await this.finishGame(room);
        return;
      }
      if (room.round >= DUEL_MAX_ROUNDS) {
        this.decideDuelOnPoints(room);
        await this.finishGame(room);
        return;
      }
    } else if (room.round >= room.settings.rounds) {
      await this.finishGame(room);
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
    room.search = null;
    room.canRetryRound = false;
    room.playedLocations = [];
    room.sharedChallengeCode = null;
    room.recorded = false;
    room.duelWinnerId = null;
    room.hp.clear();
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
    room.canRetryRound = false;
    room.target = null;
    room.roundEndsAt = null;
    room.phase = "playing";
    room.round += 1;
    room.touchedAt = Date.now();
    // Mostra "carregando" enquanto a API procura um panorama.
    room.search = { attempt: 1, maxAttempts: room.fixedLocations ? 1 : LOCATION_ATTEMPTS };
    this.broadcast(room.code);

    const location = room.fixedLocations
      ? (room.fixedLocations[room.round - 1] ?? null)
      : await this.pickWithRetry(room);

    // A sala pode ter sido fechada ou reiniciada durante a espera.
    if (this.rooms.get(room.code) !== room) return;

    room.search = null;

    if (!location) {
      this.giveUpRound(room);
      return;
    }

    room.target = location;
    room.usedPanos.add(location.panoId);
    room.playedLocations.push(location);

    // O cronometro so comeca agora: as tentativas nao podem comer o tempo de jogo.
    if (room.settings.roundSeconds > 0) {
      room.roundEndsAt = Date.now() + room.settings.roundSeconds * 1000;
      room.timer = setTimeout(
        () => this.finishRound(room),
        room.settings.roundSeconds * 1000 + TIMER_GRACE_MS,
      );
    }

    this.broadcast(room.code);
  }

  /**
   * Sorteia o local tentando algumas vezes, com espera crescente: falha de
   * rede, timeout ou cota momentanea costuma passar na tentativa seguinte.
   * Cada tentativa vai para a tela, para ninguem achar que travou.
   */
  private async pickWithRetry(room: Room): Promise<PickedLocation | null> {
    for (let attempt = 1; attempt <= LOCATION_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        room.search = { attempt, maxAttempts: LOCATION_ATTEMPTS };
        this.broadcast(room.code);
      }

      let location: PickedLocation | null = null;
      try {
        location = await this.pickLocation(room.settings.region, 12, room.usedPanos);
      } catch (err) {
        console.error("[rooms] falha ao sortear local", err);
      }

      if (this.rooms.get(room.code) !== room) return null;
      if (location) return location;

      if (attempt < LOCATION_ATTEMPTS) {
        await sleep(this.retryDelays[attempt - 1] ?? 1000);
        if (this.rooms.get(room.code) !== room) return null;
      }
    }

    return null;
  }

  /**
   * Desiste da rodada sem derrubar a partida: o placar fica intacto e o
   * anfitriao pode tentar a mesma rodada de novo por `nextRound`.
   */
  private giveUpRound(room: Room): void {
    this.clearTimer(room);
    room.round = Math.max(0, room.round - 1);
    room.target = null;
    room.roundEndsAt = null;
    room.error = LOCATION_ERROR;

    if (room.lastResult) {
      // Ja houve rodada: volta para a tela de resultado, com o placar de pe.
      room.phase = "round-result";
      room.canRetryRound = true;
    } else {
      // Falhou logo na primeira rodada: nao ha placar a perder, volta ao lobby.
      room.phase = "lobby";
      room.canRetryRound = false;
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

    const damage = room.mode === "duel" ? this.applyDuelDamage(room) : null;

    room.lastResult = { round: room.round, target: { ...room.target }, guesses, damage };
    room.target = null;
    room.touchedAt = Date.now();

    this.broadcast(room.code);
  }

  /**
   * Aplica o dano da rodada no duelo. Quem nao palpitou conta como zero, entao
   * sumir da rodada custa caro.
   */
  private applyDuelDamage(room: Room): NonNullable<RoundResult["damage"]> | null {
    const players = [...room.players.values()];
    if (players.length !== 2) return null;

    const scores = players.map((player) => ({
      playerId: player.id,
      score: room.guesses.get(player.id)?.score ?? 0,
    }));

    const damage = damageFor(room.round, scores);
    if (!damage) return null;

    const remaining = Math.max(0, (room.hp.get(damage.playerId) ?? DUEL_START_HP) - damage.amount);
    room.hp.set(damage.playerId, remaining);

    if (remaining <= 0) {
      room.duelWinnerId = players.find((p) => p.id !== damage.playerId)?.id ?? null;
    }

    return damage;
  }

  /** No limite de rodadas, quem tiver mais vida leva o duelo. */
  private decideDuelOnPoints(room: Room): void {
    const players = [...room.players.values()];
    if (players.length !== 2) return;

    const [a, b] = players;
    const hpA = room.hp.get(a.id) ?? 0;
    const hpB = room.hp.get(b.id) ?? 0;
    room.duelWinnerId = hpA === hpB ? null : hpA > hpB ? a.id : b.id;
  }

  /**
   * Encerra a partida. Mostra o placar na hora e grava no banco em seguida —
   * a persistencia nao pode segurar a tela dos jogadores.
   */
  private async finishGame(room: Room): Promise<void> {
    room.phase = "finished";
    this.broadcast(room.code);

    if (room.recorded) return;
    room.recorded = true;

    for (const player of room.players.values()) {
      try {
        await recordGame({
          profile: player.profile,
          mode: room.mode,
          region: room.settings.region,
          // No duelo o que vale e quantas rodadas realmente aconteceram.
          rounds: room.mode === "duel" ? room.round : room.settings.rounds,
          totalScore: player.totalScore,
          challengeCode: room.challengeCode,
          duelOutcome:
            room.mode !== "duel"
              ? null
              : !room.duelWinnerId
                ? "draw"
                : room.duelWinnerId === player.id
                  ? "win"
                  : "loss",
        });
      } catch (err) {
        console.error("[rooms] falha ao gravar partida", err);
      }
    }

    // Partida livre vira desafio compartilhavel com os mesmos locais.
    if (!room.challengeCode && room.playedLocations.length > 0) {
      try {
        const host = room.players.get(room.hostId);
        if (host) {
          room.sharedChallengeCode = await createChallenge({
            creator: host.profile,
            settings: { ...room.settings, rounds: room.playedLocations.length },
            locations: room.playedLocations,
          });
        }
      } catch (err) {
        console.error("[rooms] falha ao criar desafio", err);
      }
    }

    this.broadcast(room.code);
  }

  // -------------------------------------------------------------- estado

  getState(code: string): RoomState | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    return {
      code: room.code,
      mode: room.mode,
      phase: room.phase,
      challenge: room.challengeCode
        ? { code: room.challengeCode, creatorName: room.challengeCreatorName ?? "alguém" }
        : null,
      sharedChallengeCode: room.sharedChallengeCode,
      duel:
        room.mode === "duel"
          ? {
              startHp: DUEL_START_HP,
              hp: Object.fromEntries(room.hp),
              multiplier: duelMultiplier(Math.max(1, room.round)),
              winnerId: room.duelWinnerId,
            }
          : null,
      settings: room.settings,
      players: [...room.players.values()]
        .map((player): Player => ({
          id: player.id,
          name: player.name,
          avatar: player.avatar ?? DEFAULT_AVATAR,
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
      locationSearch: room.search,
      canRetryRound: room.canRetryRound,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function sanitizeSettings(settings: RoomSettings): RoomSettings {
  return {
    ...settings,
    rounds: clamp(Math.round(settings.rounds), 1, 20),
    roundSeconds: clamp(Math.round(settings.roundSeconds), 0, 600),
  };
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
