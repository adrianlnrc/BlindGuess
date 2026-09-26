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
  type StreakState,
} from "@/lib/types";
import { mapSizeKmFor, pickLocation, type PickedLocation } from "./locations";
import { paisDe, type Pais } from "./paises";
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
  /** Preenchido apenas no modo sequencia de paises. */
  streak: StreakState | null;
  /**
   * Pais onde o alvo da rodada caiu, resolvido no sorteio. Fica fora do
   * `streak` publico enquanto a rodada corre: revelar isto antes do palpite
   * seria entregar a resposta.
   */
  paisDoAlvo: Pais | null;
  settings: RoomSettings;
  players: Map<string, InternalPlayer>;
  round: number;
  /** Alvo da rodada atual — nunca vai para o cliente antes do fim da rodada. */
  target: PickedLocation | null;
  usedPanos: Set<string>;
  guesses: Map<string, Guess>;
  roundEndsAt: number | null;
  resultEndsAt: number | null;
  timer: NodeJS.Timeout | null;
  /** Separado do `timer` da rodada: os dois nunca podem se apagar por engano. */
  resultTimer: NodeJS.Timeout | null;
  lastResult: RoundResult | null;
  /** Todas as rodadas da partida, para o resumo final. */
  history: RoundResult[];
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
/**
 * Quanto o resultado da rodada fica na tela antes de avancar sozinho. Doze
 * segundos e o tempo de achar o alvo no mapa, ver de quem era cada palpite e
 * conferir o placar — menos que isso atropela quem esta lendo.
 */
const RESULT_MS = 12_000;
/**
 * O ultimo resultado espera mais: depois dele vem o placar final e a partida
 * acaba, entao e a ultima chance de olhar o mapa com calma.
 */
const FINAL_RESULT_MS = 20_000;
/** Quantas vezes tentamos sortear o local antes de desistir da rodada. */
const LOCATION_ATTEMPTS = 3;
/** Espera crescente entre as tentativas de sorteio (ms). */
const LOCATION_RETRY_DELAYS_MS = [400, 1000, 2000];
/**
 * Quantos alvos sem pais o sorteio pode devolver antes de desistir da rodada.
 * Cair no mar acontece (o panorama pode ser de uma balsa, de uma ilha sem
 * divisao administrativa); acontecer quatro vezes seguidas e sinal de que
 * insistir nao vai resolver.
 */
const STREAK_MAX_ALVOS_SEM_PAIS = 4;
/** Quantas vezes insistimos quando a consulta de pais falha (cota, rede, 500). */
const STREAK_TENTATIVAS_DE_CONSULTA = 3;
/**
 * O geocodificador nao respondeu pelo alvo. Diz o que importa para quem esta
 * jogando: a sequencia nao foi perdida, porque o erro nao foi dele.
 */
const STREAK_ALVO_SEM_RESPOSTA =
  "Não consegui descobrir em que país este lugar fica — a culpa é nossa, não sua. " +
  "Sua sequência está guardada: confira a GOOGLE_MAPS_API_KEY e a cota da API, e siga daqui.";
/** Mesma ideia no palpite: a rodada continua aberta, o jogador clica de novo. */
const STREAK_PALPITE_SEM_RESPOSTA =
  "Não consegui descobrir o país do seu palpite. Sua sequência está de pé — clique no mapa de novo.";
/** O jogador apontou para onde nao ha pais nenhum. Isso, sim, e erro dele. */
const STREAK_PALPITE_SEM_PAIS =
  "Seu palpite caiu onde não há país nenhum (mar aberto ou Antártida), então ele não bate com lugar algum.";
/** Texto unico de falha, com o que vale a pena conferir. */
const LOCATION_ERROR =
  "Não consegui carregar um local do Street View depois de várias tentativas. " +
  "Confira a GOOGLE_MAPS_API_KEY e a cota da API do Maps — o placar está guardado, dá para tentar de novo.";

/** Pontos de injecao usados nos testes; em producao valem os padroes. */
export type RoomManagerOptions = {
  /** Sorteio do local; trocado nos testes para nao depender da API do Maps. */
  pickLocation?: typeof pickLocation;
  /** Descoberta do pais; trocada nos testes para nao depender do geocodificador. */
  paisDe?: typeof paisDe;
  /** Espera entre as tentativas de sorteio, em ms. */
  retryDelaysMs?: number[];
  /** Tempo do resultado de uma rodada comum, em ms. */
  resultMs?: number;
  /** Tempo do resultado da ultima rodada, em ms. */
  finalResultMs?: number;
};

export class RoomManager {
  private rooms = new Map<string, Room>();
  private pickLocation: typeof pickLocation;
  private paisDe: typeof paisDe;
  private retryDelays: number[];
  private resultMs: number;
  private finalResultMs: number;
  /**
   * Recorde de sequencia por perfil. Deveria vir do banco — o recorde e a unica
   * coisa que sobra de uma partida de sequencia —, mas `store.ts` nao tem coluna
   * para ele e esta fora da fronteira da issue #17. Aqui ele vive enquanto o
   * processo vive: o jogador ve o recorde da sessao, e um `deploy` o zera.
   */
  private recordesDeSequencia = new Map<string, number>();

  constructor(
    private broadcast: (code: string) => void,
    options: RoomManagerOptions = {},
  ) {
    this.pickLocation = options.pickLocation ?? pickLocation;
    this.paisDe = options.paisDe ?? paisDe;
    this.retryDelays = options.retryDelaysMs ?? LOCATION_RETRY_DELAYS_MS;
    this.resultMs = options.resultMs ?? RESULT_MS;
    this.finalResultMs = options.finalResultMs ?? FINAL_RESULT_MS;
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
      streak: null,
      paisDoAlvo: null,
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
      resultEndsAt: null,
      timer: null,
      resultTimer: null,
      lastResult: null,
      history: [],
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

    if (room.mode === "solo" || room.mode === "challenge" || room.mode === "streak") {
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

  /**
   * Sala de sequencia de paises: um jogador so, sem limite de rodadas — a
   * partida acaba quando ele erra o pais.
   *
   * Sem cronometro, e nao por preguica: o modo mede paises, nao segundos. Um
   * relogio criaria um terceiro desfecho para a rodada ("o tempo acabou e nao
   * houve palpite") que as regras da issue nao definem — nao acertou, entao nao
   * soma; nao errou, entao nao deveria matar a sequencia; e uma rodada que nao
   * conta viraria uma saida gratis de qualquer lugar difícil. Como a sala tem um
   * jogador so, ninguem fica esperando por ele, e sala esquecida ja e recolhida
   * pelo TTL do `cleanup`. O `roundSeconds: 0` e imposto aqui, e nao herdado do
   * que o cliente mandar, para que essa regra indefinida nao entre pela porta
   * dos ajustes.
   */
  createStreakRoom(
    profile: PlayerProfile,
    socketId: string,
    settings?: Partial<RoomSettings>,
  ): { code: string; playerId: string } {
    const criada = this.createRoom(profile, socketId, {
      mode: "streak",
      settings: { ...settings, roundSeconds: 0 },
    });

    // Ja nasce com o estado da sequencia: o recorde aparece na tela de entrada,
    // antes da primeira rodada, porque e ele que o jogador esta tentando bater.
    const room = this.rooms.get(criada.code);
    if (room) room.streak = sequenciaNova(this.recordeDe(profile.id));

    return criada;
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
    room.history = [];
    room.playedLocations = [];
    room.sharedChallengeCode = null;
    room.recorded = false;
    room.duelWinnerId = null;

    room.hp.clear();
    if (room.mode === "duel") {
      for (const player of room.players.values()) room.hp.set(player.id, DUEL_START_HP);
    }

    room.paisDoAlvo = null;
    if (room.mode === "streak") {
      // Uma sequencia viva continua de onde estava. A sala volta ao inicio
      // tambem quando desistimos de uma rodada por falha nossa, e zerar aqui
      // faria a nossa falha custar a sequencia do jogador. Zera so o que morreu.
      const best = this.recordeDe(room);
      room.streak =
        room.streak && !room.streak.over
          ? { ...sequenciaNova(best), current: room.streak.current }
          : sequenciaNova(best);
    }

    await this.beginRound(room);
  }

  async nextRound(code: string, playerId: string): Promise<void> {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== playerId || room.phase !== "round-result") return;

    await this.advanceRound(room);
  }

  /**
   * Avanca o resultado para o que vem depois. E o unico caminho: o clique do
   * anfitriao e o timer do avanco automatico entram os dois por aqui, e o
   * primeiro que chegar cancela o outro — sem isto a sala pularia uma rodada
   * quando o anfitriao clica no mesmo instante em que o tempo vence.
   */
  private async advanceRound(room: Room): Promise<void> {
    this.clearResultTimer(room);

    // Sequencia de paises: nao ha contagem de rodadas para chegar ao fim. A
    // partida acaba no palpite errado, e isso o proprio palpite ja encerrou —
    // aqui so restam os casos de sequencia viva, que sempre seguem para a rodada
    // seguinte.
    if (room.mode === "streak") {
      if (room.streak?.over) {
        await this.finishGame(room);
        return;
      }
      await this.beginRound(room);
      return;
    }

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
    this.clearResultTimer(room);
    room.phase = "lobby";
    room.round = 0;
    room.target = null;
    room.guesses.clear();
    room.usedPanos.clear();
    room.lastResult = null;
    room.history = [];
    room.roundEndsAt = null;
    room.error = undefined;
    room.search = null;
    room.canRetryRound = false;
    room.playedLocations = [];
    room.sharedChallengeCode = null;
    room.recorded = false;
    room.duelWinnerId = null;
    room.hp.clear();
    room.paisDoAlvo = null;
    // Aqui a sequencia zera de verdade: `playAgain` e o jogador pedindo outra
    // partida, nao a sala se recuperando de uma falha nossa.
    if (room.mode === "streak") room.streak = sequenciaNova(this.recordeDe(room));
    for (const player of room.players.values()) player.totalScore = 0;

    this.broadcast(code);
  }

  submitGuess(code: string, playerId: string, position: LatLng): void {
    const room = this.rooms.get(code);
    if (!room || room.phase !== "playing" || !room.target) return;
    if (!room.players.has(playerId) || room.guesses.has(playerId)) return;
    if (!isValidLatLng(position)) return;

    // A sequencia de paises fecha a rodada por pais, nao por distancia, e para
    // isso precisa consultar o geocodificador: sai do caminho sincrono aqui.
    if (room.mode === "streak") {
      void this.palpiteDaSequencia(room, playerId, position).catch((err) =>
        console.error("[rooms] palpite da sequência", err),
      );
      return;
    }

    const player = room.players.get(playerId)!;
    const distanceMeters = haversineMeters(position, room.target);

    room.guesses.set(playerId, {
      playerId,
      playerName: player.name,
      position,
      distanceMeters,
      // Normaliza pelo tamanho do mapa: 300 km de erro num mapa do Brasil doi
      // muito mais do que 300 km no mundo inteiro.
      score: scoreForDistance(distanceMeters, mapSizeKmFor(room.settings.region)),
    });

    room.touchedAt = Date.now();
    this.maybeFinishRound(room);
    this.broadcast(code);
  }

  /**
   * `alvosSemPais` conta quantas vezes o sorteio ja caiu num ponto sem pais
   * nesta mesma rodada da sequencia: a rodada nao pode contar, entao ela e
   * refeita, e o contador e o que impede a refeicao de virar um laco infinito.
   */
  private async beginRound(room: Room, alvosSemPais = 0): Promise<void> {
    this.clearTimer(room);
    this.clearResultTimer(room);
    room.guesses.clear();
    room.error = undefined;
    room.canRetryRound = false;
    room.target = null;
    room.paisDoAlvo = null;
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

    // Sequencia de paises: o alvo so serve se o servidor souber em que pais ele
    // caiu, porque comparar esse pais com o do palpite e a regra inteira do modo.
    // Nenhuma das duas falhas possiveis aqui e do jogador, e nenhuma pode matar a
    // sequencia dele — mas elas se resolvem de formas diferentes.
    if (room.mode === "streak") {
      const pais = await this.paisDoAlvoSorteado(room, location);
      if (this.rooms.get(room.code) !== room) return;

      // Nao ha pais neste ponto (mar, Antartida): sorteio ruim, e sorteio ruim
      // se resolve sorteando de novo. Esta rodada nao chega a acontecer.
      if (pais === null) {
        if (alvosSemPais + 1 >= STREAK_MAX_ALVOS_SEM_PAIS) {
          this.paraRodadaDaSequencia(room, STREAK_ALVO_SEM_RESPOSTA);
          return;
        }
        room.round = Math.max(0, room.round - 1);
        await this.beginRound(room, alvosSemPais + 1);
        return;
      }

      // A consulta falhou mesmo depois de insistir: sortear outro local nao
      // ajudaria, porque o que esta fora do ar e o geocodificador. Para a rodada
      // com a sequencia intacta, e o jogador segue quando quiser.
      if (pais === "falha") {
        this.paraRodadaDaSequencia(room, STREAK_ALVO_SEM_RESPOSTA);
        return;
      }

      room.paisDoAlvo = pais;
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
    this.clearResultTimer(room);
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
    // Na sequencia o palpite fica registrado antes de sabermos o pais dele; por
    // aqui a rodada fecharia com um veredicto que ainda nao existe. Quem fecha a
    // rodada da sequencia e sempre `palpiteDaSequencia`.
    if (room.mode === "streak") return;

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

    room.lastResult = {
      round: room.round,
      target: { ...room.target },
      guesses,
      damage,
      mapSizeKm: mapSizeKmFor(room.settings.region),
    };
    room.history = [...room.history, room.lastResult];
    room.target = null;
    room.touchedAt = Date.now();
    this.scheduleAutoAdvance(room);

    this.broadcast(room.code);
  }

  /**
   * Marca quando o resultado avanca sozinho e arma o timer. Sem isto a sala
   * fica presa para sempre se o anfitriao fecha a aba no resultado.
   */
  private scheduleAutoAdvance(room: Room): void {
    this.clearResultTimer(room);

    // O sorteio do local falhou: tentar de novo e uma decisao de gente, nao de
    // relogio — repetir a falha sozinho so faria a sala girar em falso.
    if (room.canRetryRound) return;

    // Um jogador so: ele proprio e o anfitriao, ninguem depende dele para
    // continuar e a sala abandonada e recolhida pelo `cleanup`. Avancar sozinho
    // aqui so tiraria do desafio do dia o tempo de olhar o mapa com calma.
    const acompanhando = [...room.players.values()].filter((p) => p.connected).length;
    if (acompanhando <= 1) return;

    const espera = this.isLastResult(room) ? this.finalResultMs : this.resultMs;
    // Sem a folga de rede do cronometro da rodada: aqui nao esperamos palpite
    // de ninguem, entao o prazo mostrado na tela e a hora exata do avanco.
    room.resultEndsAt = Date.now() + espera;
    room.resultTimer = setTimeout(() => {
      void this.autoAdvance(room).catch((err) => console.error("[rooms] avanço automático", err));
    }, espera);
  }

  /** O tempo do resultado venceu e ninguem avancou antes. */
  private async autoAdvance(room: Room): Promise<void> {
    // A sala pode ter sido fechada, reiniciada ou ja avancada nesse meio tempo.
    if (this.rooms.get(room.code) !== room) return;
    if (room.phase !== "round-result" || room.resultEndsAt === null) return;

    await this.advanceRound(room);
  }

  /** Este resultado e o ultimo da partida: o proximo passo e o placar final. */
  private isLastResult(room: Room): boolean {
    if (room.mode === "duel") {
      return room.duelWinnerId !== null || room.round >= DUEL_MAX_ROUNDS;
    }
    // Na sequencia so o erro encerra: enquanto ela vive, sempre vem outro pais.
    if (room.mode === "streak") return room.streak?.over ?? false;
    return room.round >= room.settings.rounds;
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

  // -------------------------------------------------- sequencia de paises

  /**
   * Em que pais caiu o alvo sorteado. Devolve `null` quando nao ha pais ali e
   * `"falha"` quando nao conseguimos perguntar — a distincao vem de `paisDe` e e
   * o que separa "sorteia outro local" de "o geocodificador esta fora do ar".
   *
   * Insiste algumas vezes, com a mesma espera crescente do sorteio de local: cota
   * momentanea e queda de rede costumam passar na tentativa seguinte.
   */
  private async paisDoAlvoSorteado(room: Room, alvo: LatLng): Promise<Pais | null | "falha"> {
    for (let tentativa = 1; tentativa <= STREAK_TENTATIVAS_DE_CONSULTA; tentativa++) {
      try {
        return await this.paisDe(alvo);
      } catch (err) {
        console.error("[rooms] falha ao descobrir o país do alvo", err);
      }

      if (tentativa < STREAK_TENTATIVAS_DE_CONSULTA) {
        await sleep(this.retryDelays[tentativa - 1] ?? 1000);
        if (this.rooms.get(room.code) !== room) return "falha";
      }
    }

    return "falha";
  }

  /**
   * A rodada da sequencia nao pode acontecer, e a culpa e nossa. Volta para a
   * tela de entrada com o motivo na tela, sem tocar na sequencia: o jogador
   * continua de onde estava quando mandar seguir (`startGame` preserva a
   * sequencia viva de proposito).
   */
  private paraRodadaDaSequencia(room: Room, motivo: string): void {
    this.clearTimer(room);
    this.clearResultTimer(room);
    room.round = Math.max(0, room.round - 1);
    room.target = null;
    room.paisDoAlvo = null;
    room.roundEndsAt = null;
    room.search = null;
    room.phase = "lobby";
    room.canRetryRound = false;
    room.error = motivo;
    this.broadcast(room.code);
  }

  /**
   * Palpite na sequencia de paises.
   *
   * O pais sai daqui, do servidor, dos dois lados: o do alvo foi resolvido no
   * sorteio e o do palpite e resolvido agora, a partir do ponto clicado. O
   * cliente manda um ponto no mapa e mais nada — nao existe codigo de pais vindo
   * de fora que possa ser aceito, e por isso nao ha nada a validar aqui.
   */
  private async palpiteDaSequencia(room: Room, playerId: string, position: LatLng): Promise<void> {
    const alvo = room.target;
    const paisDoAlvo = room.paisDoAlvo;
    const sequencia = room.streak;
    const player = room.players.get(playerId);
    if (!alvo || !paisDoAlvo || !sequencia || !player || sequencia.over) return;

    // Registra o palpite antes da consulta: sem isto dois cliques rapidos virariam
    // duas consultas e dois veredictos para a mesma rodada.
    room.guesses.set(playerId, {
      playerId,
      playerName: player.name,
      position,
      distanceMeters: haversineMeters(position, alvo),
      // A sequencia nao tem pontuacao: a rodada e acerto ou erro.
      score: 0,
    });
    room.error = undefined;
    room.touchedAt = Date.now();
    this.broadcast(room.code);

    let paisDoPalpite: Pais | null;
    try {
      paisDoPalpite = await this.paisDe(position);
    } catch (err) {
      // Culpa nossa: nao da para chamar de erro o palpite que nem conseguimos
      // ler. A rodada continua aberta e o jogador clica de novo.
      console.error("[rooms] falha ao descobrir o país do palpite", err);
      room.guesses.delete(playerId);
      room.error = STREAK_PALPITE_SEM_RESPOSTA;
      this.broadcast(room.code);
      return;
    }

    // A sala pode ter sido fechada, reiniciada ou trocado de rodada na espera.
    if (this.rooms.get(room.code) !== room) return;
    if (room.phase !== "playing" || room.target !== alvo) return;

    // `null` aqui e o jogador apontando para o mar: nao bate com pais nenhum, e
    // isso encerra a sequencia — mas dito com todas as letras na tela, nunca em
    // silencio.
    const acertou = paisDoPalpite !== null && paisDoPalpite.code === paisDoAlvo.code;

    room.streak = {
      ...sequencia,
      current: acertou ? sequencia.current + 1 : sequencia.current,
      countryName: paisDoAlvo.name,
      countryCode: paisDoAlvo.code,
      guessCountryName: paisDoPalpite?.name ?? null,
      guessCountryCode: paisDoPalpite?.code ?? null,
      correct: acertou,
      over: !acertou,
    };
    room.streak.best = Math.max(room.streak.best, room.streak.current);
    room.error = paisDoPalpite === null ? STREAK_PALPITE_SEM_PAIS : undefined;

    // O mapa do resultado (alvo + palpite) e o mesmo dos outros modos; so o que
    // se le nele muda.
    this.clearTimer(room);
    room.lastResult = {
      round: room.round,
      target: { ...alvo },
      guesses: [...room.guesses.values()],
      damage: null,
      mapSizeKm: mapSizeKmFor(room.settings.region),
    };
    room.history = [...room.history, room.lastResult];
    room.target = null;
    room.paisDoAlvo = null;
    room.roundEndsAt = null;
    room.touchedAt = Date.now();

    if (acertou) {
      this.guardaRecorde(room, room.streak.current);
      // Sem avanco automatico: a sala tem um jogador so, ninguem espera por ele,
      // e ele decide quando quer ver o proximo lugar.
      room.phase = "round-result";
      this.broadcast(room.code);
      return;
    }

    // Errou: acabou. O resultado e o fim de jogo sao a mesma tela, porque nao ha
    // proxima rodada para separar um do outro.
    await this.finishGame(room);
  }

  /** Recorde de sequencia do dono da sala (ou de um perfil), enquanto o processo vive. */
  private recordeDe(alvo: Room | string): number {
    const id = typeof alvo === "string" ? alvo : alvo.players.get(alvo.hostId)?.profile.id;
    return (id ? this.recordesDeSequencia.get(id) : 0) ?? 0;
  }

  private guardaRecorde(room: Room, sequencia: number): void {
    const id = room.players.get(room.hostId)?.profile.id;
    if (!id) return;
    this.recordesDeSequencia.set(id, Math.max(this.recordesDeSequencia.get(id) ?? 0, sequencia));
  }

  /**
   * Encerra a partida. Mostra o placar na hora e grava no banco em seguida —
   * a persistencia nao pode segurar a tela dos jogadores.
   */
  private async finishGame(room: Room): Promise<void> {
    this.clearTimer(room);
    this.clearResultTimer(room);
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
          // No duelo e na sequencia o que vale e quantas rodadas realmente
          // aconteceram — nos dois a partida acaba antes da contagem de rodadas.
          //
          // A sequencia deveria gravar tambem o `streakLength`, que e o que a
          // issue #17 pede e o que `coinsEarned` precisa para pagar os
          // COINS_POR_PAIS: `recordGame` nao tem esse parametro e `store.ts` esta
          // fora da fronteira. Enquanto isso, a partida de sequencia conta como
          // partida jogada, mantem a ofensiva diaria — e paga zero moeda.
          rounds: room.mode === "duel" || room.mode === "streak" ? room.round : room.settings.rounds,
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

    // Partida livre vira desafio compartilhavel com os mesmos locais. A sequencia
    // fica de fora: ela nao tem pontuacao para comparar, e o numero de rodadas
    // depende de quando cada um erra — dois jogadores nunca jogariam o mesmo.
    if (!room.challengeCode && room.mode !== "streak" && room.playedLocations.length > 0) {
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
      streak: room.mode === "streak" ? room.streak : null,
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
      resultEndsAt: room.resultEndsAt,
      submitted: [...room.guesses.keys()],
      lastResult: room.lastResult,
      history: room.history,
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

  /** Cancela o avanco automatico e apaga o prazo que estava na tela. */
  private clearResultTimer(room: Room): void {
    if (room.resultTimer) clearTimeout(room.resultTimer);
    room.resultTimer = null;
    room.resultEndsAt = null;
  }

  private destroy(room: Room): void {
    this.clearTimer(room);
    this.clearResultTimer(room);
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

/** Sequencia zerada, so com o recorde que o jogador esta tentando bater. */
function sequenciaNova(best: number): StreakState {
  return {
    current: 0,
    best,
    countryName: null,
    countryCode: null,
    guessCountryName: null,
    guessCountryCode: null,
    correct: null,
    over: false,
  };
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
