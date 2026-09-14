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

export type Player = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  totalScore: number;
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

/** Estado publico enviado a todos os jogadores da sala. */
export type RoomState = {
  code: string;
  phase: RoomPhase;
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

export type ClientToServerEvents = {
  createRoom: (
    payload: { name: string },
    ack: (res: { ok: true; code: string; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  joinRoom: (
    payload: { code: string; name: string; playerId?: string },
    ack: (res: { ok: true; code: string; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  updateSettings: (payload: { settings: Partial<RoomSettings> }) => void;
  startGame: () => void;
  submitGuess: (payload: { position: LatLng }) => void;
  nextRound: () => void;
  playAgain: () => void;
  leaveRoom: () => void;
};
