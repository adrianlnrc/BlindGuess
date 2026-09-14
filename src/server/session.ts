import { getPool, hasDatabase } from "./db";

export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

/** Auth.js prefixa o cookie com __Secure- quando o site roda em HTTPS. */
const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

/**
 * Resolve o usuario logado a partir do cookie de sessao do handshake.
 * Sessao fica no banco, entao basta consultar — sem confiar em nada que o
 * cliente afirme sobre quem ele e.
 */
export async function userFromCookieHeader(header: string | undefined): Promise<SessionUser | null> {
  if (!hasDatabase() || !header) return null;

  const token = COOKIE_NAMES.map((name) => readCookie(header, name)).find(Boolean);
  if (!token) return null;

  try {
    const { rows } = await getPool().query<{
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.image
         FROM sessions s
         JOIN users u ON u.id = s."userId"
        WHERE s."sessionToken" = $1 AND s.expires > now()`,
      [token],
    );

    const row = rows[0];
    return row ? { ...row, id: String(row.id) } : null;
  } catch (err) {
    console.error("[session] falha ao validar sessão", err);
    return null;
  }
}
