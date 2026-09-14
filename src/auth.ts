import PostgresAdapter from "@auth/pg-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { getPool, hasDatabase } from "@/server/db";

/**
 * Login e opcional: quem nao entra joga como convidado. Por isso cada provedor
 * so aparece se estiver configurado, e sem banco a autenticacao fica desligada
 * em vez de derrubar o app.
 */
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const emailEnabled = !!(process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM);
export const authEnabled = hasDatabase() && (googleEnabled || emailEnabled);

function buildConfig(): NextAuthConfig {
  if (!authEnabled) return { providers: [] };

  return {
    adapter: PostgresAdapter(getPool()),
    session: { strategy: "database" },
    // O WebSocket valida a sessao lendo a tabela `sessions` no handshake.
    trustHost: true,
    providers: [
      ...(googleEnabled ? [Google] : []),
      ...(emailEnabled
        ? [Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.EMAIL_FROM })]
        : []),
    ],
    pages: {
      signIn: "/entrar",
      verifyRequest: "/entrar?enviado=1",
      error: "/entrar",
    },
    callbacks: {
      session({ session, user }) {
        if (session.user && user) session.user.id = String(user.id);
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildConfig());
