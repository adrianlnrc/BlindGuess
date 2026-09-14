"use client";

import Link from "next/link";
import type { RoomState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  isHost: boolean;
  onPlayAgain: () => void;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function FinalScores({ state, playerId, isHost, onPlayAgain }: Props) {
  const maxPossible = state.settings.rounds * 5000;

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
            <span className="flex items-center gap-3">
              <span className="w-8 text-2xl">{MEDALS[index] ?? `${index + 1}º`}</span>
              <span className="text-lg font-semibold">{player.name}</span>
            </span>
            <span className="text-xl font-bold tabular-nums text-beam-400">
              {player.totalScore.toLocaleString("pt-BR")}
            </span>
          </li>
        ))}
      </ol>

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
          Sair da sala
        </Link>
      </div>
    </main>
  );
}
