import type {
  Avatar,
  ChallengeSummary,
  Friend,
  GameMode,
  Leaderboards,
  PlayerProfile,
  ProfileStats,
  RegionId,
  RoomSettings,
} from "@/lib/types";
import { levelForXp } from "@/lib/level";
import { coinsEarned, itemById } from "@/lib/shop";
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

/** Quando o desafio de amanha abre, em ms epoch. */
export function nextDailyResetAt(at: Date = new Date()): number {
  const offsetMs = tzOffsetMs(STREAK_TZ, at);
  const tomorrow = new Date(Date.parse(`${today(at)}T00:00:00Z`) + 86_400_000);
  return Date.parse(`${tomorrow.toISOString().slice(0, 10)}T00:00:00Z`) - offsetMs;
}

/** Diferenca entre o fuso configurado e o UTC no instante dado. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - at.getTime();
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
    duel_wins: number;
    duel_losses: number;
  }>(
    `SELECT id, name, avatar, games_played, rounds_played, best_solo_score,
            total_score, streak_current, streak_longest, last_played_date,
            duel_wins, duel_losses
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
    duelWins: row.duel_wins,
    duelLosses: row.duel_losses,
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
  mode: GameMode;
  region: RegionId;
  rounds: number;
  totalScore: number;
  challengeCode?: string | null;
  /** Resultado do duelo, quando for um. */
  duelOutcome?: "win" | "loss" | "draw" | null;
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
              last_played_date = $7,
              duel_wins = duel_wins + $8,
              duel_losses = duel_losses + $9
        WHERE id = $1`,
      [
        input.profile.id,
        input.rounds,
        input.totalScore,
        input.mode === "solo" ? input.totalScore : 0,
        streakCurrent,
        streakLongest,
        day,
        input.duelOutcome === "win" ? 1 : 0,
        input.duelOutcome === "loss" ? 1 : 0,
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

    let isDaily = false;

    if (input.challengeCode) {
      const kind = await db.query<{ single_attempt: boolean }>(
        `SELECT single_attempt FROM challenges WHERE code = $1`,
        [input.challengeCode],
      );

      isDaily = !!kind.rows[0]?.single_attempt;

      if (isDaily) {
        // Desafio do dia: vale a primeira tentativa, e só ela.
        await db.query(
          `INSERT INTO challenge_entries (challenge_code, player_id, total_score)
           VALUES ($1, $2, $3)
           ON CONFLICT (challenge_code, player_id) DO NOTHING`,
          [input.challengeCode, input.profile.id, input.totalScore],
        );
      } else {
        // Desafio avulso: uma entrada por pessoa, guardando a melhor marca.
        await db.query(
          `INSERT INTO challenge_entries (challenge_code, player_id, total_score)
           VALUES ($1, $2, $3)
           ON CONFLICT (challenge_code, player_id) DO UPDATE
             SET total_score = EXCLUDED.total_score, played_at = now()
           WHERE challenge_entries.total_score < EXCLUDED.total_score`,
          [input.challengeCode, input.profile.id, input.totalScore],
        );
      }
    }

    const coins = coinsEarned({
      totalScore: input.totalScore,
      mode: input.mode,
      isDaily,
      duelOutcome: input.duelOutcome,
    });

    if (coins > 0) {
      await db.query(`UPDATE players SET coins = coins + $2 WHERE id = $1`, [
        input.profile.id,
        coins,
      ]);
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

// ----------------------------------------------------------------- amigos

const FRIEND_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Codigo curto do jogador, gerado na primeira vez que alguem pede. */
export async function getFriendCode(playerId: string): Promise<string> {
  const db = getPool();

  const existing = await db.query<{ friend_code: string | null }>(
    `SELECT friend_code FROM players WHERE id = $1`,
    [playerId],
  );

  if (!existing.rows[0]) throw new Error("Jogador não encontrado.");
  if (existing.rows[0].friend_code) return existing.rows[0].friend_code;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = Array.from(
      { length: 6 },
      () => FRIEND_ALPHABET[Math.floor(Math.random() * FRIEND_ALPHABET.length)],
    ).join("");

    const { rows } = await db.query<{ friend_code: string }>(
      `UPDATE players SET friend_code = $2
        WHERE id = $1 AND friend_code IS NULL
          AND NOT EXISTS (SELECT 1 FROM players WHERE friend_code = $2)
        RETURNING friend_code`,
      [playerId, code],
    );

    if (rows[0]) return rows[0].friend_code;
  }

  throw new Error("Não consegui gerar um código de amigo.");
}

/** Lista de amigos, com nivel e ofensiva de cada um. */
export async function getFriends(
  playerId: string,
  isOnline: (id: string) => boolean,
): Promise<Friend[]> {
  const { rows } = await getPool().query<{
    id: string;
    name: string;
    avatar: Avatar;
    total_score: string;
    streak_current: number;
  }>(
    `SELECT p.id, p.name, p.avatar, p.total_score, p.streak_current
       FROM friendships f
       JOIN players p ON p.id = f.friend_id
      WHERE f.player_id = $1
      ORDER BY p.name`,
    [playerId],
  );

  return rows.map((row) => ({
    profileId: row.id,
    name: row.name,
    avatar: row.avatar,
    online: isOnline(row.id),
    level: levelForXp(Number(row.total_score)),
    streak: row.streak_current,
  }));
}

/**
 * Adiciona pelo codigo. A amizade vale nos dois sentidos: quem passou o codigo
 * ja consentiu, entao nao ha convite pendente para aceitar.
 */
export async function addFriendByCode(
  playerId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getPool();

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM players WHERE friend_code = $1`,
    [code.trim().toUpperCase()],
  );

  const friendId = rows[0]?.id;
  if (!friendId) return { ok: false, error: "Código não encontrado." };
  if (friendId === playerId) return { ok: false, error: "Esse código é o seu." };

  await db.query(
    `INSERT INTO friendships (player_id, friend_id) VALUES ($1, $2), ($2, $1)
     ON CONFLICT DO NOTHING`,
    [playerId, friendId],
  );

  return { ok: true };
}

/**
 * Existe amizade entre os dois? O convite de sala confia nisto, nunca no que o
 * cliente afirma: `friendId` chega do payload, então a amizade precisa estar
 * gravada no banco — e no sentido de quem convida, que é o único id vindo da
 * conexão. A tabela guarda os dois sentidos (veja `addFriendByCode`), então uma
 * linha basta.
 */
export async function areFriends(playerId: string, friendId: string): Promise<boolean> {
  if (!playerId || !friendId || playerId === friendId) return false;

  const { rowCount } = await getPool().query(
    `SELECT 1 FROM friendships WHERE player_id = $1 AND friend_id = $2 LIMIT 1`,
    [playerId, friendId],
  );

  return (rowCount ?? 0) > 0;
}

export async function removeFriend(playerId: string, friendId: string): Promise<void> {
  await getPool().query(
    `DELETE FROM friendships
      WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`,
    [playerId, friendId],
  );
}

// --------------------------------------------------------------- carteira

export type Wallet = { coins: number; items: string[] };

export async function getWallet(playerId: string): Promise<Wallet> {
  const db = getPool();

  const player = await db.query<{ coins: number }>(
    `SELECT coins FROM players WHERE id = $1`,
    [playerId],
  );

  const items = await db.query<{ item_id: string }>(
    `SELECT item_id FROM player_items WHERE player_id = $1`,
    [playerId],
  );

  return {
    coins: player.rows[0]?.coins ?? 0,
    items: items.rows.map((row) => row.item_id),
  };
}

/** Itens que o jogador pode equipar. Usado para nao aceitar item nao comprado. */
export async function getOwnedItems(playerId: string): Promise<Set<string>> {
  const { rows } = await getPool().query<{ item_id: string }>(
    `SELECT item_id FROM player_items WHERE player_id = $1`,
    [playerId],
  );
  return new Set(rows.map((row) => row.item_id));
}

/**
 * Compra um item. O preco vem do catalogo do servidor, nunca do cliente, e o
 * debito e a entrega acontecem na mesma transacao.
 */
export async function buyItem(
  playerId: string,
  itemId: string,
): Promise<{ ok: true; wallet: Wallet } | { ok: false; error: string }> {
  const item = itemById(itemId);
  if (!item) return { ok: false, error: "Item não existe." };

  const db = await getPool().connect();

  try {
    await db.query("BEGIN");

    const player = await db.query<{ coins: number }>(
      `SELECT coins FROM players WHERE id = $1 FOR UPDATE`,
      [playerId],
    );

    if (!player.rows[0]) {
      await db.query("ROLLBACK");
      return { ok: false, error: "Jogador não encontrado." };
    }

    const owned = await db.query(
      `SELECT 1 FROM player_items WHERE player_id = $1 AND item_id = $2`,
      [playerId, itemId],
    );

    if (owned.rowCount) {
      await db.query("ROLLBACK");
      return { ok: false, error: "Você já tem esse item." };
    }

    if (player.rows[0].coins < item.price) {
      await db.query("ROLLBACK");
      return { ok: false, error: "Moedas insuficientes." };
    }

    await db.query(`UPDATE players SET coins = coins - $2 WHERE id = $1`, [playerId, item.price]);
    await db.query(
      `INSERT INTO player_items (player_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [playerId, itemId],
    );

    await db.query("COMMIT");
    return { ok: true, wallet: await getWallet(playerId) };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

// --------------------------------------------------------------- desafios

export async function createChallenge(input: {
  creator: PlayerProfile;
  settings: RoomSettings;
  locations: PickedLocation[];
  singleAttempt?: boolean;
}): Promise<string> {
  const db = getPool();

  await saveProfile(input.creator);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(
      { length: 8 },
      () => CHALLENGE_ALPHABET[Math.floor(Math.random() * CHALLENGE_ALPHABET.length)],
    ).join("");

    const { rowCount } = await db.query(
      `INSERT INTO challenges (code, creator_id, settings, locations, single_attempt)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [
        code,
        input.creator.id,
        JSON.stringify(input.settings),
        JSON.stringify(input.locations),
        input.singleAttempt ?? false,
      ],
    );

    if (rowCount) return code;
  }

  throw new Error("Não consegui gerar um código de desafio livre.");
}

export async function getChallenge(code: string): Promise<{
  code: string;
  creatorName: string;
  settings: RoomSettings;
  locations: PickedLocation[];
  singleAttempt: boolean;
} | null> {
  const { rows } = await getPool().query<{
    code: string;
    creator_name: string | null;
    settings: RoomSettings;
    locations: PickedLocation[];
    single_attempt: boolean;
  }>(
    `SELECT c.code, p.name AS creator_name, c.settings, c.locations, c.single_attempt
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
    singleAttempt: row.single_attempt,
  };
}

/** Se o jogador ja tem entrada neste desafio. */
export async function hasPlayedChallenge(code: string, playerId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM challenge_entries WHERE challenge_code = $1 AND player_id = $2`,
    [code, playerId],
  );
  return !!rowCount;
}

// ------------------------------------------------------------ desafio do dia

export async function getDailyCode(day: string): Promise<string | null> {
  const { rows } = await getPool().query<{ challenge_code: string }>(
    `SELECT challenge_code FROM daily_challenges WHERE day = $1`,
    [day],
  );
  return rows[0]?.challenge_code ?? null;
}

/**
 * Fixa o desafio do dia. Se dois jogadores abrirem o jogo ao mesmo tempo e os
 * dois sortearem locais, o primeiro a gravar ganha e o outro adota o dele —
 * todo mundo joga exatamente os mesmos lugares.
 */
export async function setDailyCode(day: string, code: string): Promise<string> {
  const db = getPool();

  await db.query(
    `INSERT INTO daily_challenges (day, challenge_code) VALUES ($1, $2)
     ON CONFLICT (day) DO NOTHING`,
    [day, code],
  );

  const winner = await getDailyCode(day);
  return winner ?? code;
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
    single_attempt: boolean;
  }>(
    `SELECT c.code, p.name AS creator_name, p.avatar AS creator_avatar, c.settings,
            jsonb_array_length(c.locations) AS rounds, c.created_at, c.single_attempt
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
    singleAttempt: row.single_attempt,
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
