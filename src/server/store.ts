import type {
  Avatar,
  ChallengeSummary,
  Leaderboards,
  PlayerProfile,
  ProfileStats,
  RegionId,
  RoomSettings,
} from "@/lib/types";
import { getPool } from "./db";
import type { PickedLocation } from "./locations";

/** Fuso usado para decidir a virada do dia no streak. */
const STREAK_TZ = process.env.BLINDGUESS_TIMEZONE ?? "America/Sao_Paulo";

const MAX_LEADERBOARD = 20;
const CHALLENGE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

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
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/** Datas voltam do pg como Date; o resto do app fala YYYY-MM-DD. */
function toIsoDay(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// --------------------------------------------------------------- jogadores

/** Cria o jogador se ainda nao existir e mantem nome/avatar atualizados. */
export async function saveProfile(profile: PlayerProfile): Promise<void> {
  await getPool().query(
    `INSERT INTO players (id, name, avatar)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar`,
    [profile.id, profile.name, JSON.stringify(profile.avatar)],
  );
}

/** O jogador ligado a uma conta, se houver. */
export async function getPlayerForUser(userId: string): Promise<PlayerProfile | null> {
  const { rows } = await getPool().query<{ id: string; name: string; avatar: Avatar }>(
    `SELECT id, name, avatar FROM players WHERE user_id = $1`,
    [userId],
  );

  const row = rows[0];
  return row ? { id: row.id, name: row.name, avatar: row.avatar } : null;
}

/**
 * Liga um perfil de convidado a uma conta recem-logada, preservando streak,
 * pontuacao e desafios. Só funciona se o convidado ainda não tiver dono e a
 * conta ainda não tiver jogador — senão devolve o jogador que a conta já tem.
 */
export async function claimGuest(
  userId: string,
  guestId: string,
  fallback: { name: string; avatar: Avatar },
): Promise<PlayerProfile> {
  const db = await getPool().connect();

  try {
    await db.query("BEGIN");

    const existing = await db.query<{ id: string; name: string; avatar: Avatar }>(
      `SELECT id, name, avatar FROM players WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );

    if (existing.rows[0]) {
      await db.query("COMMIT");
      return existing.rows[0];
    }

    const claimed = await db.query<{ id: string; name: string; avatar: Avatar }>(
      `UPDATE players SET user_id = $1
       WHERE id = $2 AND user_id IS NULL
       RETURNING id, name, avatar`,
      [userId, guestId],
    );

    if (claimed.rows[0]) {
      await db.query("COMMIT");
      return claimed.rows[0];
    }

    // Convidado já pertence a outra conta (ou não existe): abre um jogador novo.
    const fresh = await db.query<{ id: string; name: string; avatar: Avatar }>(
      `INSERT INTO players (id, user_id, name, avatar)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, avatar`,
      [`u${userId}-${Math.random().toString(36).slice(2, 8)}`, userId, fallback.name, JSON.stringify(fallback.avatar)],
    );

    await db.query("COMMIT");
    return fresh.rows[0];
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export async function getStats(playerId: string): Promise<ProfileStats | null> {
  const db = getPool();

  const { rows } = await db.query<{
    id: string;
    name: string;
    avatar: Avatar;
    games_played: number;
    rounds_played: number;
    best_solo_score: number;
    total_score: string;
    streak_current: number;
    streak_longest: number;
    last_played_date: Date | null;
  }>(
    `SELECT id, name, avatar, games_played, rounds_played, best_solo_score,
            total_score, streak_current, streak_longest, last_played_date
       FROM players WHERE id = $1`,
    [playerId],
  );

  const row = rows[0];
  if (!row) return null;

  const days = await db.query<{ day: Date }>(
    `SELECT day FROM player_days WHERE player_id = $1 ORDER BY day DESC LIMIT 365`,
    [playerId],
  );

  return {
    profileId: row.id,
    name: row.name,
    avatar: row.avatar,
    gamesPlayed: row.games_played,
    roundsPlayed: row.rounds_played,
    bestSoloScore: row.best_solo_score,
    // BIGINT volta como string no driver do pg.
    totalScore: Number(row.total_score),
    streak: {
      current: row.streak_current,
      longest: row.streak_longest,
      lastPlayedDate: toIsoDay(row.last_played_date),
      history: days.rows.map((d) => toIsoDay(d.day)!).filter(Boolean),
    },
  };
}

/**
 * Registra uma partida concluida: totais, streak diario, ranking solo e a
 * entrada no desafio. Jogar varias vezes no mesmo dia nao infla o streak.
 */
export async function recordGame(input: {
  profile: PlayerProfile;
  mode: "party" | "solo" | "challenge";
  region: RegionId;
  rounds: number;
  totalScore: number;
  challengeCode?: string | null;
}): Promise<void> {
  const db = await getPool().connect();
  const day = today();

  try {
    await db.query("BEGIN");

    await db.query(
      `INSERT INTO players (id, name, avatar)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar`,
      [input.profile.id, input.profile.name, JSON.stringify(input.profile.avatar)],
    );

    const current = await db.query<{
      streak_current: number;
      streak_longest: number;
      last_played_date: Date | null;
    }>(
      `SELECT streak_current, streak_longest, last_played_date
         FROM players WHERE id = $1 FOR UPDATE`,
      [input.profile.id],
    );

    const row = current.rows[0]!;
    const lastDay = toIsoDay(row.last_played_date);

    let streakCurrent = row.streak_current;
    let streakLongest = row.streak_longest;

    if (lastDay !== day) {
      const gap = lastDay ? daysBetween(lastDay, day) : null;
      streakCurrent = gap === 1 ? streakCurrent + 1 : 1;
      streakLongest = Math.max(streakLongest, streakCurrent);
    }

    await db.query(
      `UPDATE players
          SET games_played = games_played + 1,
              rounds_played = rounds_played + $2,
              total_score = total_score + $3,
              best_solo_score = GREATEST(best_solo_score, $4),
              streak_current = $5,
              streak_longest = $6,
              last_played_date = $7
        WHERE id = $1`,
      [
        input.profile.id,
        input.rounds,
        input.totalScore,
        input.mode === "solo" ? input.totalScore : 0,
        streakCurrent,
        streakLongest,
        day,
      ],
    );

    await db.query(
      `INSERT INTO player_days (player_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [input.profile.id, day],
    );

    if (input.mode === "solo") {
      await db.query(
        `INSERT INTO solo_entries (player_id, score, rounds, region) VALUES ($1, $2, $3, $4)`,
        [input.profile.id, input.totalScore, input.rounds, input.region],
      );
    }

    if (input.challengeCode) {
      // Uma entrada por pessoa: só sobrescreve se a marca nova for melhor.
      await db.query(
        `INSERT INTO challenge_entries (challenge_code, player_id, total_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (challenge_code, player_id) DO UPDATE
           SET total_score = EXCLUDED.total_score, played_at = now()
         WHERE challenge_entries.total_score < EXCLUDED.total_score`,
        [input.challengeCode, input.profile.id, input.totalScore],
      );
    }

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export async function getLeaderboards(): Promise<Leaderboards> {
  const db = getPool();

  const solo = await db.query<{
    player_id: string;
    name: string;
    avatar: Avatar;
    score: number;
    rounds: number;
    region: RegionId;
    played_at: Date;
  }>(
    `SELECT e.player_id, p.name, p.avatar, e.score, e.rounds, e.region, e.played_at
       FROM solo_entries e
       JOIN players p ON p.id = e.player_id
      ORDER BY e.score DESC, e.played_at ASC
      LIMIT $1`,
    [MAX_LEADERBOARD],
  );

  const streaks = await db.query<{
    id: string;
    name: string;
    avatar: Avatar;
    streak_current: number;
    streak_longest: number;
  }>(
    `SELECT id, name, avatar, streak_current, streak_longest
       FROM players
      WHERE streak_longest > 0
      ORDER BY streak_current DESC, streak_longest DESC
      LIMIT $1`,
    [MAX_LEADERBOARD],
  );

  return {
    solo: solo.rows.map((r) => ({
      profileId: r.player_id,
      name: r.name,
      avatar: r.avatar,
      score: r.score,
      rounds: r.rounds,
      region: r.region,
      playedAt: r.played_at.getTime(),
    })),
    streaks: streaks.rows.map((r) => ({
      profileId: r.id,
      name: r.name,
      avatar: r.avatar,
      current: r.streak_current,
      longest: r.streak_longest,
    })),
  };
}

// --------------------------------------------------------------- desafios

export async function createChallenge(input: {
  creator: PlayerProfile;
  settings: RoomSettings;
  locations: PickedLocation[];
}): Promise<string> {
  const db = getPool();

  await saveProfile(input.creator);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(
      { length: 8 },
      () => CHALLENGE_ALPHABET[Math.floor(Math.random() * CHALLENGE_ALPHABET.length)],
    ).join("");

    const { rowCount } = await db.query(
      `INSERT INTO challenges (code, creator_id, settings, locations)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [code, input.creator.id, JSON.stringify(input.settings), JSON.stringify(input.locations)],
    );

    if (rowCount) return code;
  }

  throw new Error("Não consegui gerar um código de desafio livre.");
}

export async function getChallenge(
  code: string,
): Promise<{ code: string; creatorName: string; settings: RoomSettings; locations: PickedLocation[] } | null> {
  const { rows } = await getPool().query<{
    code: string;
    creator_name: string | null;
    settings: RoomSettings;
    locations: PickedLocation[];
  }>(
    `SELECT c.code, p.name AS creator_name, c.settings, c.locations
       FROM challenges c
       LEFT JOIN players p ON p.id = c.creator_id
      WHERE c.code = $1`,
    [code],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    code: row.code,
    creatorName: row.creator_name ?? "alguém",
    settings: row.settings,
    locations: row.locations,
  };
}

export async function getChallengeSummary(code: string): Promise<ChallengeSummary | null> {
  const db = getPool();

  const { rows } = await db.query<{
    code: string;
    creator_name: string | null;
    creator_avatar: Avatar | null;
    settings: RoomSettings;
    rounds: number;
    created_at: Date;
  }>(
    `SELECT c.code, p.name AS creator_name, p.avatar AS creator_avatar, c.settings,
            jsonb_array_length(c.locations) AS rounds, c.created_at
       FROM challenges c
       LEFT JOIN players p ON p.id = c.creator_id
      WHERE c.code = $1`,
    [code],
  );

  const row = rows[0];
  if (!row) return null;

  const entries = await db.query<{
    player_id: string;
    name: string;
    avatar: Avatar;
    total_score: number;
    played_at: Date;
  }>(
    `SELECT e.player_id, p.name, p.avatar, e.total_score, e.played_at
       FROM challenge_entries e
       JOIN players p ON p.id = e.player_id
      WHERE e.challenge_code = $1
      ORDER BY e.total_score DESC, e.played_at ASC
      LIMIT 100`,
    [code],
  );

  return {
    code: row.code,
    creatorName: row.creator_name ?? "alguém",
    creatorAvatar: row.creator_avatar ?? DEFAULT_CREATOR_AVATAR,
    settings: row.settings,
    rounds: Number(row.rounds),
    createdAt: row.created_at.getTime(),
    entries: entries.rows.map((e) => ({
      profileId: e.player_id,
      name: e.name,
      avatar: e.avatar,
      totalScore: e.total_score,
      playedAt: e.played_at.getTime(),
    })),
  };
}

const DEFAULT_CREATOR_AVATAR: Avatar = {
  skin: "#c98d63",
  outfit: "#16b886",
  accent: "#ffb454",
  hat: "cap",
  face: "smile",
};
