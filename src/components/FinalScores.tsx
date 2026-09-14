"use client";

import Link from "next/link";
import { useState } from "react";
import Avatar from "./Avatar";
import DuelBars from "./DuelBars";
import type { RoomState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  isHost: boolean;
  onPlayAgain: () => void;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function FinalScores({ state, playerId, isHost, onPlayAgain }: Props) {
  const [copied, setCopied] = useState(false);
  const maxPossible = state.settings.rounds * 5000;

  // Toda partida livre vira um desafio compartilhavel com os mesmos locais.
  const shareCode = state.sharedChallengeCode ?? state.challenge?.code ?? null;

  async function copyChallenge() {
    if (!shareCode) return;
    await navigator.clipboard.writeText(`${window.location.origin}/desafio/${shareCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (state.duel) {
    const winner = state.players.find((p) => p.id === state.duel!.winnerId) ?? null;
    const iWon = !!winner && winner.id === playerId;

    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-8 px-6 py-12">
        <header className="text-center">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Fim do duelo</p>
          <h1
            className={`text-5xl font-black ${
              !winner ? "text-mist-100" : iWon ? "text-beam-400" : "text-rose-signal"
            }`}
          >
            {!winner ? "Empate" : iWon ? "Vitória" : "Derrota"}
          </h1>
          <p className="mt-2 text-mist-300">
            {winner
              ? `${winner.name} venceu em ${state.round} ${state.round === 1 ? "rodada" : "rodadas"}.`
              : `Ninguém zerou a vida em ${state.round} rodadas.`}
          </p>
        </header>

        <section className="panel rounded-2xl p-5">
          <DuelBars duel={state.duel} players={state.players} meId={playerId} />
        </section>

        <div className="flex flex-wrap gap-3">
          {isHost && (
            <button
              type="button"
              onClick={onPlayAgain}
              className="flex-1 rounded-2xl bg-beam-500 px-6 py-4 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
            >
              Revanche
            </button>
          )}
          <Link
            href="/"
            className="flex-1 rounded-2xl border border-ink-600 px-6 py-4 text-center text-lg font-semibold transition hover:border-beam-500 hover:text-beam-400"
          >
            Sair
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <header className="text-center">
        <p className="text-xs tracking-widest text-mist-300 uppercase">Fim de jogo</p>
        <h1 className="text-4xl font-black">Placar final</h1>
        <p className="mt-2 text-mist-300">
          {state.settings.rounds} rodadas · até {maxPossible.toLocaleString("pt-BR")} pontos
        </p>
      </header>

      <ol className="space-y-3">
        {state.players.map((player, index) => (
          <li
            key={player.id}
            className={`panel flex items-center justify-between rounded-2xl px-5 py-4 ${
              player.id === playerId ? "border-beam-500/60" : ""
            } ${index === 0 ? "scale-[1.02]" : ""}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-8 text-2xl">{MEDALS[index] ?? `${index + 1}º`}</span>
              <Avatar avatar={player.avatar} size={40} className="rounded-lg" />
              <span className="truncate text-lg font-semibold">{player.name}</span>
            </span>
            <span className="text-xl font-bold tabular-nums text-beam-400">
              {player.totalScore.toLocaleString("pt-BR")}
            </span>
          </li>
        ))}
      </ol>

      {shareCode && (
        <section className="panel space-y-3 rounded-2xl p-5 text-center">
          <p className="text-mist-300">
            {state.challenge
              ? "Mande o link para mais gente encarar os mesmos lugares."
              : "Transforme esta partida num desafio: seus amigos jogam os mesmos lugares quando quiserem."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={copyChallenge}
              className="rounded-xl bg-flare-400 px-5 py-2.5 font-semibold text-ink-950 transition hover:brightness-110"
            >
              {copied ? "Link copiado!" : "Copiar link do desafio"}
            </button>
            <Link
              href={`/desafio/${shareCode}`}
              className="rounded-xl border border-ink-600 px-5 py-2.5 font-semibold transition hover:border-beam-500 hover:text-beam-400"
            >
              Ver placar do desafio
            </Link>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        {isHost && (
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 rounded-2xl bg-beam-500 px-6 py-4 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
          >
            Jogar de novo
          </button>
        )}
        <Link
          href="/"
          className="flex-1 rounded-2xl border border-ink-600 px-6 py-4 text-center text-lg font-semibold transition hover:border-beam-500 hover:text-beam-400"
        >
          {state.mode === "party" ? "Sair da sala" : "Voltar ao início"}
        </Link>
      </div>
    </main>
  );
}
