import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Avatar,
  ChallengeSummary,
  Leaderboards,
  PlayerProfile,
  ProfileStats,
  RegionId,
  RoomSettings,
  SoloEntry,
  StreakInfo,
} from "@/lib/types";
import type { PickedLocation } from "./locations";

/**
 * Persistencia simples em arquivo JSON. Escala o suficiente para um grupo de
 * amigos; se um dia virar publico, trocar por Postgres mexendo so neste modulo.
 */

const DATA_FILE = process.env.BLINDGUESS_DATA_FILE ?? join(process.cwd(), "data", "blindguess.json");
/** Fuso usado para decidir o "dia" de um streak. */
const STREAK_TZ = process.env.BLINDGUESS_TIMEZONE ?? "America/Sao_Paulo";

const MAX_SOLO_ENTRIES = 200;
const MAX_HISTORY_DAYS = 365;
const MAX_CHALLENGE_ENTRIES = 100;

type StoredProfile = {
  id: string;
  name: string;
  avatar: Avatar;
  gamesPlayed: number;
  roundsPlayed: number;
  bestSoloScore: number;
  totalScore: number;
  streak: StreakInfo;
};

type StoredChallenge = {
  code: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar: Avatar;
  settings: RoomSettings;
  locations: PickedLocation[];
  createdAt: number;
  entries: { profileId: string; name: string; avatar: Avatar; totalScore: number; playedAt: number }[];
};

type StoreShape = {
  profiles: Record<string, StoredProfile>;
  challenges: Record<string, StoredChallenge>;
  solo: SoloEntry[];
};

const CHALLENGE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function emptyStore(): StoreShape {
  return { profiles: {}, challenges: {}, solo: [] };
}

function load(): StoreShape {
  try {
    const raw = readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      profiles: parsed.profiles ?? {},
      challenges: parsed.challenges ?? {},
      solo: parsed.solo ?? [],
    };
  } catch {
    return emptyStore();
  }
}

const store: StoreShape = load();
let writeTimer: NodeJS.Timeout | null = null;

/** Grava com arquivo temporario + rename, para nunca deixar um JSON pela metade. */
function flush(): void {
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store), "utf8");
    renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error("[store] falha ao gravar", err);
  }
}

/** Agrupa gravacoes proximas numa so. */
function persist(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 250);
  writeTimer.unref?.();
}

export function flushNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

// ------------------------------------------------------------------ datas

/** Data de hoje (YYYY-MM-DD) no fuso configurado. */
export function today(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STREAK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// --------------------------------------------------------------- perfis

function ensureProfile(profile: PlayerProfile): StoredProfile {
  const existing = store.profiles[profile.id];
  if (existing) {
    existing.name = profile.name;
    existing.avatar = profile.avatar;
    return existing;
  }

  const created: StoredProfile = {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    gamesPlayed: 0,
    roundsPlayed: 0,
    bestSoloScore: 0,
    totalScore: 0,
    streak: { current: 0, longest: 0, lastPlayedDate: null, history: [] },
  };
  store.profiles[profile.id] = created;
  return created;
}

export function saveProfile(profile: PlayerProfile): void {
  ensureProfile(profile);
  persist();
}

export function getStats(profileId: string): ProfileStats | null {
  const p = store.profiles[profileId];
  if (!p) return null;

  return {
    profileId: p.id,
    name: p.name,
    avatar: p.avatar,
    gamesPlayed: p.gamesPlayed,
    roundsPlayed: p.roundsPlayed,
    bestSoloScore: p.bestSoloScore,
    totalScore: p.totalScore,
    streak: p.streak,
  };
}

/**
 * Registra uma partida concluida: atualiza totais, o streak diario e — no modo
 * solo — o ranking. Jogar varias vezes no mesmo dia nao infla o streak.
 */
export function recordGame(input: {
  profile: PlayerProfile;
  mode: "party" | "solo" | "challenge";
  region: RegionId;
  rounds: number;
  totalScore: number;
  challengeCode?: string | null;
}): void {
  const p = ensureProfile(input.profile);
  const day = today();

  p.gamesPlayed += 1;
  p.roundsPlayed += input.rounds;
  p.totalScore += input.totalScore;

  if (input.mode === "solo" && input.totalScore > p.bestSoloScore) {
    p.bestSoloScore = input.totalScore;
  }

  // Streak: so muda quando o dia vira.
  if (p.streak.lastPlayedDate !== day) {
    const gap = p.streak.lastPlayedDate ? daysBetween(p.streak.lastPlayedDate, day) : null;
    p.streak.current = gap === 1 ? p.streak.current + 1 : 1;
    p.streak.longest = Math.max(p.streak.longest, p.streak.current);
    p.streak.lastPlayedDate = day;
    p.streak.history = [day, ...p.streak.history.filter((d) => d !== day)].slice(0, MAX_HISTORY_DAYS);
  }

  if (input.mode === "solo") {
    store.solo.push({
      profileId: p.id,
      name: p.name,
      avatar: p.avatar,
      score: input.totalScore,
      rounds: input.rounds,
      region: input.region,
      playedAt: Date.now(),
    });
    store.solo.sort((a, b) => b.score - a.score);
    store.solo = store.solo.slice(0, MAX_SOLO_ENTRIES);
  }

  if (input.challengeCode) {
    const challenge = store.challenges[input.challengeCode];
    if (challenge) {
      // Uma entrada por pessoa: mantem a melhor pontuacao.
      const previous = challenge.entries.find((e) => e.profileId === p.id);
      if (!previous) {
        challenge.entries.push({
          profileId: p.id,
          name: p.name,
          avatar: p.avatar,
          totalScore: input.totalScore,
          playedAt: Date.now(),
        });
      } else if (input.totalScore > previous.totalScore) {
        previous.totalScore = input.totalScore;
        previous.playedAt = Date.now();
        previous.name = p.name;
        previous.avatar = p.avatar;
      }

      challenge.entries.sort((a, b) => b.totalScore - a.totalScore);
      challenge.entries = challenge.entries.slice(0, MAX_CHALLENGE_ENTRIES);
    }
  }

  persist();
}

export function getLeaderboards(): Leaderboards {
  const streaks = Object.values(store.profiles)
    .filter((p) => p.streak.longest > 0)
    .sort((a, b) => b.streak.current - a.streak.current || b.streak.longest - a.streak.longest)
    .slice(0, 20)
    .map((p) => ({
      profileId: p.id,
      name: p.name,
      avatar: p.avatar,
      current: p.streak.current,
      longest: p.streak.longest,
    }));

  return { solo: store.solo.slice(0, 20), streaks };
}

// ------------------------------------------------------------- desafios

export function createChallenge(input: {
  creator: PlayerProfile;
  settings: RoomSettings;
  locations: PickedLocation[];
}): string {
  let code = "";
  do {
    code = Array.from(
      { length: 8 },
      () => CHALLENGE_ALPHABET[Math.floor(Math.random() * CHALLENGE_ALPHABET.length)],
    ).join("");
  } while (store.challenges[code]);

  store.challenges[code] = {
    code,
    creatorId: input.creator.id,
    creatorName: input.creator.name,
    creatorAvatar: input.creator.avatar,
    settings: input.settings,
    locations: input.locations,
    createdAt: Date.now(),
    entries: [],
  };

  ensureProfile(input.creator);
  persist();
  return code;
}

export function getChallenge(code: string): StoredChallenge | null {
  return store.challenges[code] ?? null;
}

export function getChallengeSummary(code: string): ChallengeSummary | null {
  const c = store.challenges[code];
  if (!c) return null;

  return {
    code: c.code,
    creatorName: c.creatorName,
    creatorAvatar: c.creatorAvatar,
    settings: c.settings,
    rounds: c.locations.length,
    createdAt: c.createdAt,
    entries: c.entries,
  };
}
