"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import AvatarEditor from "@/components/AvatarEditor";
import StreakBadge from "@/components/StreakBadge";
import { loadProfile, saveProfileLocal } from "@/lib/profile";
import { getSocket, rememberPlayer } from "@/lib/socket";
import type { Avatar as AvatarType, PlayerProfile, ProfileStats } from "@/lib/types";

type Mode = "solo" | "party" | "challenge";

export default function HomePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [account, setAccount] = useState<{ authenticated: boolean; email: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Mode | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setProfile(loadProfile()), []);

  /**
   * Diz ao servidor quem somos e recebe a identidade canônica de volta: logado,
   * o id vem da conta (e adota o perfil de convidado no primeiro login).
   */
  useEffect(() => {
    if (!profile) return;

    const socket = getSocket();

    const identify = () => {
      socket.emit("identify", { profile }, (res) => {
        if (!res.ok) return;

        setAccount({ authenticated: res.authenticated, email: res.email });

        // O servidor pode devolver outro id (conta) ou o nome vindo do Google.
        if (res.profile.id !== profile.id || res.profile.name !== profile.name) {
          setProfile(res.profile);
          saveProfileLocal(res.profile);
        }

        socket.emit("fetchStats", { profileId: res.profile.id }, (r) => setStats(r.stats));
      });
    };

    identify();
    socket.on("connect", identify);
    return () => {
      socket.off("connect", identify);
    };
    // Reidentifica quando a identidade muda, não a cada tecla no apelido.
  }, [profile?.id]);

  const update = useCallback((patch: Partial<PlayerProfile>) => {
    setProfile((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      saveProfileLocal(next);
      return next;
    });
  }, []);

  const updateAvatar = useCallback(
    (patch: Partial<AvatarType>) => {
      setProfile((current) => {
        if (!current) return current;
        const next = { ...current, avatar: { ...current.avatar, ...patch } };
        saveProfileLocal(next);
        return next;
      });
    },
    [],
  );

  if (!profile) {
    return (
      <main className="grid min-h-dvh place-content-center">
        <p className="text-mist-300">Carregando…</p>
      </main>
    );
  }

  const nickname = profile.name.trim();
  const ready = nickname.length > 0 && busy === null;

  function enter(roomCode: string, playerId: string) {
    rememberPlayer(roomCode, playerId);
    router.push(`/room/${roomCode}`);
  }

  function start(mode: Mode) {
    if (!ready || !profile) return;
    setBusy(mode);
    setError(null);

    const payload = { profile: { ...profile, name: nickname } };

    if (mode === "solo") {
      getSocket().emit("createSolo", payload, (res) => {
        setBusy(null);
        if (res.ok) enter(res.code, res.playerId);
        else setError(res.error);
      });
    } else if (mode === "party") {
      getSocket().emit("createRoom", payload, (res) => {
        setBusy(null);
        if (res.ok) enter(res.code, res.playerId);
        else setError(res.error);
      });
    } else {
      getSocket().emit("createChallenge", payload, (res) => {
        setBusy(null);
        if (res.ok) enter(res.code, res.playerId);
        else setError(res.error);
      });
    }
  }

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (!ready || roomCode.length < 4 || !profile) return;

    setBusy("join");
    setError(null);
    getSocket().emit("joinRoom", { code: roomCode, profile: { ...profile, name: nickname } }, (res) => {
      setBusy(null);
      if (res.ok) enter(res.code, res.playerId);
      else setError(res.error);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-900/60 px-3 py-1 text-xs font-medium tracking-widest text-beam-400 uppercase">
            <span className="size-1.5 rounded-full bg-beam-400" />
            sozinho, com amigos ou por desafio
          </span>
          <h1 className="text-5xl font-black tracking-tight sm:text-6xl">
            Blind<span className="text-beam-400">Guess</span>
          </h1>
          <p className="max-w-lg text-lg text-mist-300">
            Você cai num ponto aleatório do planeta sem saber onde está. Leia as placas, a
            vegetação, o lado da pista — e crave o palpite antes do tempo acabar.
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          <StreakBadge streak={stats?.streak ?? null} />

          {account?.authenticated ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-mist-300">
                {account.email ? account.email : "conta conectada"}
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-lg border border-ink-600 px-3 py-1.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
              >
                Sair
              </button>
            </div>
          ) : (
            <Link
              href="/entrar"
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm font-medium transition hover:border-beam-500 hover:text-beam-400"
            >
              Entrar e salvar meu progresso
            </Link>
          )}
        </div>
      </header>

      {/* Perfil */}
      <section className="panel rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar avatar={profile.avatar} size={64} className="rounded-xl" />

          <div className="min-w-48 flex-1">
            <label htmlFor="nickname" className="text-xs tracking-widest text-mist-300 uppercase">
              Seu apelido
            </label>
            <input
              id="nickname"
              value={profile.name}
              onChange={(e) => update({ name: e.target.value.slice(0, 18) })}
              placeholder="ex: adrian"
              maxLength={18}
              className="mt-1 w-full rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-2.5 text-lg outline-none focus:border-beam-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
          >
            {editing ? "Fechar" : "Personalizar"}
          </button>
        </div>

        {editing && (
          <div className="mt-6 border-t border-ink-700 pt-6">
            <AvatarEditor avatar={profile.avatar} onChange={updateAvatar} />
          </div>
        )}

        {stats && stats.gamesPlayed > 0 && (
          <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-ink-700 pt-5 sm:grid-cols-4">
            <Stat label="Partidas" value={stats.gamesPlayed.toLocaleString("pt-BR")} />
            <Stat label="Rodadas" value={stats.roundsPlayed.toLocaleString("pt-BR")} />
            <Stat label="Recorde solo" value={stats.bestSoloScore.toLocaleString("pt-BR")} />
            <Stat label="Pontos totais" value={stats.totalScore.toLocaleString("pt-BR")} />
          </dl>
        )}
      </section>

      {/* Modos */}
      <section className="grid gap-4 sm:grid-cols-3">
        <ModeCard
          title="Jogar solo"
          description="Partida sozinho. A pontuação entra no ranking e conta pro seu streak."
          action="Começar agora"
          highlight
          disabled={!ready}
          loading={busy === "solo"}
          onClick={() => start("solo")}
        />
        <ModeCard
          title="Sala com amigos"
          description="Todo mundo joga as mesmas rodadas ao mesmo tempo, com placar ao vivo."
          action="Criar sala"
          disabled={!ready}
          loading={busy === "party"}
          onClick={() => start("party")}
        />
        <ModeCard
          title="Desafio por link"
          description="Sorteia os locais, você joga e manda o link. Cada um joga quando quiser."
          action="Criar desafio"
          disabled={!ready}
          loading={busy === "challenge"}
          onClick={() => start("challenge")}
        />
      </section>

      {/* Entrar em sala */}
      <form onSubmit={handleJoin} className="panel flex flex-wrap items-end gap-4 rounded-2xl p-6">
        <div className="flex-1">
          <label htmlFor="code" className="text-xs tracking-widest text-mist-300 uppercase">
            Entrar numa sala
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="ABC12"
            maxLength={5}
            className="mt-1 w-full rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-2.5 text-center text-xl font-bold tracking-[0.4em] uppercase outline-none focus:border-beam-500"
          />
        </div>
        <button
          type="submit"
          disabled={!ready || code.trim().length < 4}
          className="rounded-xl border border-ink-600 px-6 py-2.5 font-semibold transition hover:border-beam-500 hover:text-beam-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "join" ? "Entrando…" : "Entrar"}
        </button>
      </form>

      {!nickname && (
        <p className="text-center text-mist-300">Escolha um apelido para liberar os modos de jogo.</p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-signal/40 bg-rose-signal/10 px-4 py-3 text-rose-signal">
          {error}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-700 pt-6 text-sm text-mist-300">
        <p>
          Cada rodada vale até <strong className="text-mist-100">5.000 pontos</strong> — quanto mais
          perto do local real, maior a nota.
        </p>
        <Link href="/ranking" className="font-semibold text-beam-400 hover:underline">
          Ver ranking e streaks →
        </Link>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-widest text-mist-300 uppercase">{label}</dt>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function ModeCard({
  title,
  description,
  action,
  onClick,
  disabled,
  loading,
  highlight = false,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`panel flex flex-col gap-3 rounded-2xl p-6 ${
        highlight ? "border-beam-500/50" : ""
      }`}
    >
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="flex-1 text-sm text-mist-300">{description}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        className={`rounded-xl px-4 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          highlight
            ? "bg-beam-500 text-ink-950 hover:bg-beam-400"
            : "border border-ink-600 hover:border-beam-500 hover:text-beam-400"
        }`}
      >
        {loading ? "Preparando…" : action}
      </button>
    </div>
  );
}
