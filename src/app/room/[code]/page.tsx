"use client";

import Link from "next/link";
import { use } from "react";
import ChatSala from "@/components/ChatSala";
import FinalScores from "@/components/FinalScores";
import GameView from "@/components/GameView";
import Lobby from "@/components/Lobby";
import RoundResult from "@/components/RoundResult";
import { storedPlayerId } from "@/lib/socket";
import { useRoom } from "@/lib/useRoom";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const { state, me, status, error, updateSettings, startGame, nextRound, playAgain, submitGuess } =
    useRoom(code);

  if (status === "error") {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-bold">Não deu para entrar na sala {code}</h1>
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
        <p className="text-mist-300">Sala {code}</p>
      </main>
    );
  }

  const playerId = me?.id ?? storedPlayerId(code);
  const isHost = !!me?.isHost;
  // Sala de um jogador só (solo e desafio) não tem com quem conversar; o chat
  // aparece onde entra mais gente pelo código.
  const temChat = state.mode === "party" || state.mode === "duel";

  const telas = {
    playing: <GameView state={state} playerId={playerId} onGuess={submitGuess} />,
    "round-result": (
      <RoundResult state={state} playerId={playerId} isHost={isHost} onNext={nextRound} />
    ),
    finished: (
      <FinalScores state={state} playerId={playerId} isHost={isHost} onPlayAgain={playAgain} />
    ),
    lobby: (
      <Lobby
        code={state.code}
        mode={state.mode}
        challenge={state.challenge}
        players={state.players}
        settings={state.settings}
        isHost={isHost}
        error={state.error ?? error ?? undefined}
        onUpdateSettings={updateSettings}
        onStart={startGame}
        chat={temChat ? <ChatSala code={state.code} variante="painel" meuId={playerId} /> : null}
      />
    ),
  };

  // A bolha fica fora da tela escolhida: assim ela sobrevive à troca de fase,
  // em vez de ser remontada (perdendo a rolagem) entre a rodada e o resultado.
  return (
    <>
      {telas[state.phase]}
      {temChat && state.phase !== "lobby" && <ChatSala code={state.code} variante="bolha" meuId={playerId} />}
    </>
  );
}
