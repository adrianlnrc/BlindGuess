"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-content-center text-mist-300">Carregando…</main>}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const params = useSearchParams();
  const sent = params.get("enviado") === "1";
  const authError = params.get("error");

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [options, setOptions] = useState<{ google: boolean; email: boolean } | null>(null);

  // O servidor diz o que esta ligado, para a tela seguir as variaveis sem rebuild.
  useEffect(() => {
    fetch("/api/auth-options")
      .then((res) => res.json())
      .then(setOptions)
      .catch(() => setOptions({ google: false, email: false }));
  }, []);

  const googleEnabled = options?.google ?? false;
  const emailEnabled = options?.email ?? false;

  function withGoogle() {
    setBusy("google");
    signIn("google", { callbackUrl: "/" });
  }

  function withEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy("email");
    signIn("resend", { email: email.trim(), callbackUrl: "/" });
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 text-center">
        <h1 className="text-3xl font-black">Link enviado</h1>
        <p className="text-mist-300">
          Abra o e-mail que acabamos de mandar e clique no link para entrar. Ele vale por
          pouco tempo e só funciona uma vez.
        </p>
        <Link href="/" className="text-beam-400 hover:underline">
          Voltar ao início
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-black">
          Entrar no Blind<span className="text-beam-400">Guess</span>
        </h1>
        <p className="text-mist-300">
          Entrar guarda seu streak, seu ranking e seu personagem entre aparelhos. Dá para
          jogar sem conta — só não acumula progresso.
        </p>
      </header>

      {authError && (
        <p className="rounded-xl border border-rose-signal/40 bg-rose-signal/10 px-4 py-3 text-rose-signal">
          Não consegui completar o login. Tente de novo.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {googleEnabled && (
          <button
            type="button"
            onClick={withGoogle}
            disabled={busy !== null}
            className="flex items-center justify-center gap-3 rounded-xl bg-mist-100 px-4 py-3.5 text-lg font-semibold text-ink-950 transition hover:brightness-95 disabled:opacity-50"
          >
            {busy === "google" ? "Abrindo…" : "Entrar com Google"}
          </button>
        )}

        {googleEnabled && emailEnabled && (
          <div className="flex items-center gap-3 text-xs tracking-widest text-mist-300 uppercase">
            <span className="h-px flex-1 bg-ink-700" />
            ou
            <span className="h-px flex-1 bg-ink-700" />
          </div>
        )}

        {emailEnabled && (
          <form onSubmit={withEmail} className="flex flex-col gap-3">
            <label htmlFor="email" className="text-xs tracking-widest text-mist-300 uppercase">
              Seu e-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              className="rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-3 text-lg outline-none focus:border-beam-500"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-xl bg-beam-500 px-4 py-3.5 text-lg font-semibold text-ink-950 transition hover:bg-beam-400 disabled:opacity-50"
            >
              {busy === "email" ? "Enviando…" : "Receber link por e-mail"}
            </button>
            <p className="text-sm text-mist-300">
              Sem senha: mandamos um link que entra direto.
            </p>
          </form>
        )}

        {options && !googleEnabled && !emailEnabled && (
          <p className="rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-flare-400">
            O login ainda não foi configurado neste servidor. Defina as variáveis do Google
            ou do Resend para habilitar.
          </p>
        )}
      </div>

      <Link href="/" className="text-center text-mist-300 hover:text-beam-400">
        Jogar como convidado →
      </Link>
    </main>
  );
}

