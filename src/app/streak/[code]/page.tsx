"use client";

import Link from "next/link";
import { use } from "react";
import StreakView from "@/components/StreakView";
import { storedPlayerId } from "@/lib/socket";
import { useRoom } from "@/lib/useRoom";

/**
 * Rota própria da sequência de países. A sala vive no mesmo `RoomManager` das
 * outras, mas a tela não tem nada em comum com `/room/[code]`: nenhuma fase
 * mostra placar, e não há chat nem convite — a sala é de um jogador só.
 */
export default function StreakPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const { state, me, status, error, startGame, nextRound, playAgain, submitGuess } = useRoom(code);

  if (status === "error") {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-bold">Não deu para entrar na sequência {code}</h1>
        <p className="text-mist-300">{error}</p>
        <Link
          href="/"
          className="mx-auto rounded-xl bg-beam-500 px-6 py-3 font-semibold text-ink-950 transition hover:bg-beam-400"
        >
          Voltar ao início
        </Link>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="grid min-h-dvh place-content-center gap-2 text-center">
        <p className="text-2xl font-semibold">Conectando…</p>
        <p className="text-mist-300">Sequência {code}</p>
      </main>
    );
  }

  return (
    <StreakView
      state={state}
      playerId={me?.id ?? storedPlayerId(code)}
      onGuess={submitGuess}
      onStart={startGame}
      onNext={nextRound}
      onPlayAgain={playAgain}
    />
  );
}
