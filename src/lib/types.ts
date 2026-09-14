export type LatLng = { lat: number; lng: number };

export type RegionId = "world" | "brazil" | "europe" | "americas" | "asia" | "famous";

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

export type HatId = "none" | "cap" | "explorer" | "beanie" | "headphones";
export type FaceId = "smile" | "focused" | "glasses" | "shades";

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

export type GameMode = "party" | "solo" | "challenge";

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
};

export type RoomPhase = "lobby" | "playing" | "round-result" | "finished";

export type ChallengeSummary = {
  code: string;
  creatorName: string;
  creatorAvatar: Avatar;
  settings: RoomSettings;
  rounds: number;
  createdAt: number;
  entries: ChallengeEntry[];
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
};

export type ServerToClientEvents = {
  state: (state: RoomState) => void;
  errorMessage: (message: string) => void;
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
  updateSettings: (payload: { settings: Partial<RoomSettings> }) => void;
  startGame: () => void;
  submitGuess: (payload: { position: LatLng }) => void;
  nextRound: () => void;
  playAgain: () => void;
  leaveRoom: () => void;
};
