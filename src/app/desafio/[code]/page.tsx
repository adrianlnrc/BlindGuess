"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { mapLabel } from "@/lib/catalog";
import { loadProfile } from "@/lib/profile";
import { getSocket, rememberPlayer } from "@/lib/socket";
import type { ChallengeSummary, PlayerProfile } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function ChallengePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [challenge, setChallenge] = useState<ChallengeSummary | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setProfile(loadProfile()), []);

  useEffect(() => {
    const socket = getSocket();
    const fetch = () =>
      socket.emit("fetchChallenge", { code }, (res) => {
        if (res.ok) setChallenge(res.challenge);
        else setError(res.error);
      });

    fetch();
    socket.on("connect", fetch);
    return () => {
      socket.off("connect", fetch);
    };
  }, [code]);

  function play() {
    if (!profile?.name.trim() || busy) return;

    setBusy(true);
    setError(null);
    getSocket().emit("playChallenge", { profile, challengeCode: code }, (res) => {
      setBusy(false);
      if (res.ok) {
        rememberPlayer(res.code, res.playerId);
        router.push(`/room/${res.code}`);
      } else {
        setError(res.error);
      }
    });
  }

  if (error && !challenge) {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-bold">Desafio não encontrado</h1>
        <p className="text-mist-300">{error}</p>
        <Link
          href="/"
          className="mx-auto rounded-xl bg-beam-500 px-6 py-3 font-semibold text-ink-950 transition hover:bg-beam-400"
        >
          Ir para o início
        </Link>
      </main>
    );
  }

  if (!challenge || !profile) {
    return (
      <main className="grid min-h-dvh place-content-center">
        <p className="text-mist-300">Carregando desafio…</p>
      </main>
    );
  }

  const alreadyPlayed = challenge.entries.find((e) => e.profileId === profile.id);
  const nickname = profile.name.trim();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="flex items-center gap-4">
        <Avatar avatar={challenge.creatorAvatar} size={72} className="rounded-2xl" />
        <div>
          <p className="text-xs tracking-widest text-mist-300 uppercase">Desafio de</p>
          <h1 className="text-3xl font-black">{challenge.creatorName}</h1>
          <p className="text-mist-300">
            {challenge.rounds} rodadas · {mapLabel(challenge.settings.region)} ·{" "}
            {challenge.settings.roundSeconds === 0
              ? "sem limite"
              : `${challenge.settings.roundSeconds}s por rodada`}
          </p>
        </div>
      </header>

      <p className="panel rounded-2xl p-5 text-mist-300">
        Você vai jogar <strong className="text-mist-100">exatamente os mesmos lugares</strong> que
        todo mundo deste desafio. Vale a sua melhor pontuação.
      </p>

      {challenge.entries.length > 0 && (
        <section className="panel rounded-2xl p-6">
          <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
            Placar do desafio
          </h2>
          <ol className="mt-4 space-y-2">
            {challenge.entries.map((entry, index) => (
              <li
                key={entry.profileId}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  entry.profileId === profile.id
                    ? "border-beam-500/60 bg-beam-500/5"
                    : "border-ink-700 bg-ink-950/40"
                }`}
              >
                <span className="w-7 text-center text-lg">{MEDALS[index] ?? index + 1}</span>
                <Avatar avatar={entry.avatar} size={32} className="rounded-lg" />
                <span className="flex-1 truncate font-medium">{entry.name}</span>
                <span className="font-bold tabular-nums text-beam-400">
                  {entry.totalScore.toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="space-y-3">
        {!nickname && (
          <p className="text-center text-mist-300">
            Defina seu apelido na tela inicial antes de jogar.
          </p>
        )}

        <button
          type="button"
          onClick={play}
          disabled={!nickname || busy}
          className="w-full rounded-2xl bg-beam-500 px-6 py-4 text-xl font-bold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Preparando…"
            : alreadyPlayed
              ? "Jogar de novo e melhorar a marca"
              : "Aceitar o desafio"}
        </button>

        {alreadyPlayed && (
          <p className="text-center text-sm text-mist-300">
            Sua melhor marca aqui: {alreadyPlayed.totalScore.toLocaleString("pt-BR")} pontos.
          </p>
        )}

        {error && <p className="text-center text-rose-signal">{error}</p>}

        <Link href="/" className="block text-center text-sm text-mist-300 hover:text-beam-400">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
