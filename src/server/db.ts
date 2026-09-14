import { Pool } from "pg";

/**
 * Pool unico de conexoes. A URL vem do Railway (DATABASE_URL); em producao o
 * Postgres deles exige TLS, mas com certificado proprio — daí o rejectUnauthorized.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada — o banco é obrigatório para login e ranking.");
  }

  pool = new Pool({
    connectionString,
    ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });

  pool.on("error", (err) => console.error("[db] erro no pool", err));
  return pool;
}

function needsSsl(url: string): boolean {
  if (process.env.PGSSLMODE === "disable" || url.includes("sslmode=disable")) return false;
  // Conexoes locais de desenvolvimento nao usam TLS.
  return !/@(localhost|127\.0\.0\.1|::1)[:/]/.test(url);
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Cria o schema se ainda nao existir. As quatro primeiras tabelas sao as que o
 * adapter do Auth.js espera, com os nomes de coluna que ele usa (camelCase
 * entre aspas). As demais sao do jogo.
 */
export async function migrate(): Promise<void> {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255),
      "emailVerified" TIMESTAMPTZ,
      image TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(255) NOT NULL,
      provider VARCHAR(255) NOT NULL,
      "providerAccountId" VARCHAR(255) NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at BIGINT,
      id_token TEXT,
      scope TEXT,
      session_state TEXT,
      token_type TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires TIMESTAMPTZ NOT NULL,
      "sessionToken" VARCHAR(255) NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS verification_token (
      identifier TEXT NOT NULL,
      expires TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL,
      PRIMARY KEY (identifier, token)
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      avatar JSONB NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0,
      rounds_played INTEGER NOT NULL DEFAULT 0,
      best_solo_score INTEGER NOT NULL DEFAULT 0,
      total_score BIGINT NOT NULL DEFAULT 0,
      streak_current INTEGER NOT NULL DEFAULT 0,
      streak_longest INTEGER NOT NULL DEFAULT 0,
      last_played_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS player_days (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      PRIMARY KEY (player_id, day)
    );

    CREATE TABLE IF NOT EXISTS solo_entries (
      id BIGSERIAL PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      rounds INTEGER NOT NULL,
      region TEXT NOT NULL,
      played_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS challenges (
      code TEXT PRIMARY KEY,
      creator_id TEXT REFERENCES players(id) ON DELETE SET NULL,
      settings JSONB NOT NULL,
      locations JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS challenge_entries (
      challenge_code TEXT NOT NULL REFERENCES challenges(code) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      total_score INTEGER NOT NULL,
      played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (challenge_code, player_id)
    );

    -- Desafio do dia: um por data, o mesmo para todo mundo.
    CREATE TABLE IF NOT EXISTS daily_challenges (
      day DATE PRIMARY KEY,
      challenge_code TEXT NOT NULL REFERENCES challenges(code) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS solo_entries_score_idx ON solo_entries (score DESC);
    CREATE INDEX IF NOT EXISTS players_streak_idx ON players (streak_current DESC, streak_longest DESC);

    -- Uma tentativa só: vale para o desafio do dia, não para os avulsos.
    ALTER TABLE challenges ADD COLUMN IF NOT EXISTS single_attempt BOOLEAN NOT NULL DEFAULT false;

    -- Cartel de duelos.
    ALTER TABLE players ADD COLUMN IF NOT EXISTS duel_wins INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS duel_losses INTEGER NOT NULL DEFAULT 0;
  `);
}
