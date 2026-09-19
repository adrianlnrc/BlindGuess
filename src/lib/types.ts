export type LatLng = { lat: number; lng: number };

export type RegionId =
  | "world"
  | "brazil"
  | "europe"
  | "americas"
  | "asia"
  | "famous"
  | "africa"
  | "oceania"
  | "world_rural";

export type RoomSettings = {
  rounds: number;
  /** Segundos por rodada. 0 = sem limite. */
  roundSeconds: number;
  region: RegionId;
  /** Permite andar pelas setas do Street View. */
  allowMove: boolean;
  /** Permite girar a camera. */
  allowPan: boolean;
  /** Permite dar zoom. */
  allowZoom: boolean;
};

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 5,
  roundSeconds: 120,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

/** Aparencia do bonequinho do jogador — geometria propria, montada em SVG. */
export type Avatar = {
  skin: string;
  outfit: string;
  accent: string;
  hat: HatId;
  face: FaceId;
};

export type HatId =
  | "none"
  | "cap"
  | "explorer"
  | "beanie"
  | "headphones"
  | "bucket"
  | "visor"
  | "helmet"
  | "crown";

export type FaceId =
  | "smile"
  | "focused"
  | "glasses"
  | "shades"
  | "wink"
  | "grin"
  | "eyepatch";

export const DEFAULT_AVATAR: Avatar = {
  skin: "#c98d63",
  outfit: "#16b886",
  accent: "#ffb454",
  hat: "cap",
  face: "smile",
};

/** Identidade que persiste entre partidas (localStorage no cliente). */
export type PlayerProfile = {
  id: string;
  name: string;
  avatar: Avatar;
};

export type GameMode = "party" | "solo" | "challenge" | "duel";

export type Player = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  totalScore: number;
  avatar: Avatar;
};

export type Guess = {
  playerId: string;
  playerName: string;
  position: LatLng;
  distanceMeters: number;
  score: number;
};

export type RoundResult = {
  round: number;
  target: LatLng;
  guesses: Guess[];
  /** Só no duelo: quem levou dano e quanto. */
  damage?: { playerId: string; amount: number; multiplier: number } | null;
};

/** Estado do duelo 1v1. */
export type DuelState = {
  startHp: number;
  hp: Record<string, number>;
  /** Multiplicador de dano da rodada atual. */
  multiplier: number;
  /** Definido quando o duelo acaba. */
  winnerId: string | null;
};

export type RoomPhase = "lobby" | "playing" | "round-result" | "finished";

export type ChallengeSummary = {
  code: string;
  creatorName: string;
  creatorAvatar: Avatar;
  settings: RoomSettings;
  rounds: number;
  createdAt: number;
  /** Desafio do dia: vale só a primeira tentativa. */
  singleAttempt: boolean;
  entries: ChallengeEntry[];
};

/** Estado do desafio do dia para este jogador. */
export type DailyInfo = {
  day: string;
  challengeCode: string;
  rounds: number;
  /** Quando o desafio de amanhã abre (ms epoch). */
  resetsAt: number;
  alreadyPlayed: boolean;
  myScore: number | null;
  topEntries: ChallengeEntry[];
};

export type ChallengeEntry = {
  profileId: string;
  name: string;
  avatar: Avatar;
  totalScore: number;
  playedAt: number;
};

export type StreakInfo = {
  current: number;
  longest: number;
  lastPlayedDate: string | null;
  /** Datas (YYYY-MM-DD) em que o jogador jogou, mais recentes primeiro. */
  history: string[];
};

export type ProfileStats = {
  profileId: string;
  name: string;
  avatar: Avatar;
  gamesPlayed: number;
  roundsPlayed: number;
  bestSoloScore: number;
  totalScore: number;
  duelWins: number;
  duelLosses: number;
  streak: StreakInfo;
};

export type SoloEntry = {
  profileId: string;
  name: string;
  avatar: Avatar;
  score: number;
  rounds: number;
  region: RegionId;
  playedAt: number;
};

export type Friend = {
  profileId: string;
  name: string;
  avatar: Avatar;
  online: boolean;
  level: number;
  streak: number;
};

export type Leaderboards = {
  solo: SoloEntry[];
  streaks: { profileId: string; name: string; avatar: Avatar; current: number; longest: number }[];
};

/** Estado publico enviado a todos os jogadores da sala. */
export type RoomState = {
  code: string;
  mode: GameMode;
  phase: RoomPhase;
  /** Preenchido quando a sala joga um desafio criado por alguem. */
  challenge: { code: string; creatorName: string } | null;
  /** Codigo de desafio gerado a partir desta partida, se houver. */
  sharedChallengeCode: string | null;
  /** Preenchido apenas no modo duelo. */
  duel: DuelState | null;
  settings: RoomSettings;
  players: Player[];
  round: number;
  /** Definido apenas durante `playing`: onde o panorama deve abrir. */
  panorama: { panoId: string } | null;
  /** Timestamp (ms epoch) em que a rodada acaba. null = sem limite. */
  roundEndsAt: number | null;
  /** Ids de quem ja enviou palpite na rodada atual. */
  submitted: string[];
  lastResult: RoundResult | null;
  error?: string;
  /**
   * Preenchido enquanto o servidor procura o local da rodada. Serve para a
   * tela mostrar "tentativa 2 de 3" em vez de parecer travada.
   */
  locationSearch: LocationSearch | null;
  /**
   * true quando o sorteio do local desistiu: o placar esta intacto e o
   * anfitriao pode tentar a mesma rodada de novo.
   */
  canRetryRound: boolean;
};

/** Progresso da busca pelo panorama da rodada. */
export type LocationSearch = {
  /** Tentativa em andamento, comecando em 1. */
  attempt: number;
  /** Quantas tentativas serao feitas no total. */
  maxAttempts: number;
};

export type ServerToClientEvents = {
  state: (state: RoomState) => void;
  errorMessage: (message: string) => void;
  /** Quantas pessoas estão com o jogo aberto agora. */
  presence: (payload: { online: number }) => void;
};

type RoomAck = (
  res: { ok: true; code: string; playerId: string } | { ok: false; error: string },
) => void;

export type ClientToServerEvents = {
  /** Diz ao servidor quem somos e recebe de volta a identidade canônica. */
  identify: (
    payload: { profile: PlayerProfile },
    ack: (
      res:
        | { ok: true; profile: PlayerProfile; authenticated: boolean; email: string | null }
        | { ok: false; error: string },
    ) => void,
  ) => void;
  createRoom: (payload: { profile: PlayerProfile }, ack: RoomAck) => void;
  joinRoom: (payload: { code: string; profile: PlayerProfile; playerId?: string }, ack: RoomAck) => void;
  /** Cria uma sala de um jogador so. */
  createSolo: (payload: { profile: PlayerProfile; settings?: Partial<RoomSettings> }, ack: RoomAck) => void;
  /** Sorteia os locais, guarda como desafio e abre uma sala para o criador jogar. */
  createChallenge: (
    payload: { profile: PlayerProfile; settings?: Partial<RoomSettings> },
    ack: (
      res: { ok: true; code: string; playerId: string; challengeCode: string } | { ok: false; error: string },
    ) => void,
  ) => void;
  /** Abre uma sala com os locais exatos de um desafio existente. */
  playChallenge: (payload: { profile: PlayerProfile; challengeCode: string }, ack: RoomAck) => void;
  fetchChallenge: (
    payload: { code: string },
    ack: (res: { ok: true; challenge: ChallengeSummary } | { ok: false; error: string }) => void,
  ) => void;
  fetchStats: (
    payload: { profileId: string },
    ack: (res: { stats: ProfileStats | null }) => void,
  ) => void;
  fetchLeaderboards: (ack: (res: { leaderboards: Leaderboards }) => void) => void;
  /**
   * Saldo de moedas e itens de quem está nesta conexão. Não leva profileId: a
   * identidade vem da sessão ou do `identify`, nunca do payload.
   */
  fetchWallet: (ack: (res: { coins: number; items: string[] }) => void) => void;
  /** Meu código de amigo e a lista de amigos com presença. */
  fetchFriends: (
    ack: (res: { ok: true; myCode: string; friends: Friend[] } | { ok: false; error: string }) => void,
  ) => void;
  /** Adiciona um amigo pelo código dele. */
  addFriend: (
    payload: { code: string },
    ack: (res: { ok: true; friends: Friend[] } | { ok: false; error: string }) => void,
  ) => void;
  removeFriend: (
    payload: { friendId: string },
    ack: (res: { ok: true; friends: Friend[] } | { ok: false; error: string }) => void,
  ) => void;
  /** Compra um item da loja com as moedas do jogador. */
  buyItem: (
    payload: { itemId: string },
    ack: (
      res: { ok: true; coins: number; items: string[] } | { ok: false; error: string },
    ) => void,
  ) => void;
  /** Estado do desafio do dia (sorteia os locais na primeira vez do dia). */
  fetchDaily: (
    ack: (res: { ok: true; daily: DailyInfo } | { ok: false; error: string }) => void,
  ) => void;
  /** Abre uma sala com o desafio do dia. */
  playDaily: (payload: { profile: PlayerProfile }, ack: RoomAck) => void;
  /** Cria uma sala de duelo 1v1 (o adversário entra pelo código). */
  createDuel: (payload: { profile: PlayerProfile; settings?: Partial<RoomSettings> }, ack: RoomAck) => void;
  updateSettings: (payload: { settings: Partial<RoomSettings> }) => void;
  startGame: () => void;
  submitGuess: (payload: { position: LatLng }) => void;
  nextRound: () => void;
  playAgain: () => void;
  leaveRoom: () => void;
};
