"use client";

import Avatar from "./Avatar";
import DuelBars from "./DuelBars";
import ResultMap, { PLAYER_COLORS } from "./ResultMap";
import ScoreBar from "./ScoreBar";
import { formatDistance } from "@/lib/scoring";
import type { RoomState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  isHost: boolean;
  onNext: () => void;
};

export default function RoundResult({ state, playerId, isHost, onNext }: Props) {
  const result = state.lastResult;
  if (!result) return null;

  // O sorteio do local desistiu: o placar esta guardado e da para tentar de novo.
  const retry = state.canRetryRound;
  const isLastRound = state.duel
    ? !!state.duel.winnerId
    : result.round >= state.settings.rounds;
  const missing = state.players.filter((p) => !result.guesses.some((g) => g.playerId === p.id));
  const avatarOf = (id: string) => state.players.find((p) => p.id === id)?.avatar;
  const myGuess = result.guesses.find((g) => g.playerId === playerId) ?? null;

  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      <div className="h-1/2 w-full lg:h-full lg:flex-1">
        <ResultMap target={result.target} guesses={result.guesses} />
      </div>

      <aside className="flex h-1/2 w-full flex-col gap-4 overflow-y-auto border-t border-ink-700 bg-ink-900/80 p-6 lg:h-full lg:w-96 lg:border-t-0 lg:border-l">
        <header>
          <p className="text-xs tracking-widest text-mist-300 uppercase">
            {state.duel ? `Rodada ${result.round}` : `Rodada ${result.round} de ${state.settings.rounds}`}
          </p>
          <h2 className="text-2xl font-bold">Resultado</h2>
        </header>

        {state.duel && (
          <section className="rounded-xl border border-ink-700 p-4">
            <DuelBars
              duel={state.duel}
              players={state.players}
              meId={playerId}
              hitId={result.damage?.playerId ?? null}
            />

            <p className="mt-3 text-center text-sm">
              {result.damage ? (
                <>
                  <strong className="text-rose-signal">
                    −{result.damage.amount.toLocaleString("pt-BR")} de vida
                  </strong>{" "}
                  <span className="text-mist-300">
                    para {state.players.find((p) => p.id === result.damage!.playerId)?.name} · dano ×
                    {result.damage.multiplier}
                  </span>
                </>
              ) : (
                <span className="text-mist-300">Empate na rodada — ninguém perdeu vida.</span>
              )}
            </p>
          </section>
        )}

        {myGuess && (
          <section className="rounded-xl border border-beam-500/40 bg-beam-500/5 p-4">
            <ScoreBar score={myGuess.score} distanceMeters={myGuess.distanceMeters} />
          </section>
        )}

        <ol className="space-y-2">
          {result.guesses.map((guess, index) => (
            <li
              key={guess.playerId}
              className={`rounded-xl border px-4 py-3 ${
                guess.playerId === playerId
                  ? "border-beam-500/60 bg-beam-500/5"
                  : "border-ink-700 bg-ink-950/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }}
                  />
                  {avatarOf(guess.playerId) && (
                    <Avatar avatar={avatarOf(guess.playerId)!} size={24} className="rounded-md" />
                  )}
                  <span className="truncate">{guess.playerName}</span>
                </span>
                <span className="font-bold text-beam-400">
                  +{guess.score.toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="mt-1 text-sm text-mist-300">
                errou por {formatDistance(guess.distanceMeters)}
              </p>
            </li>
          ))}

          {missing.map((player) => (
            <li
              key={player.id}
              className="rounded-xl border border-ink-700 bg-ink-950/40 px-4 py-3 text-mist-300"
            >
              <div className="flex items-center justify-between">
                <span>{player.name}</span>
                <span className="font-bold">+0</span>
              </div>
              <p className="mt-1 text-sm">não palpitou a tempo</p>
            </li>
          ))}
        </ol>

        <section
          className="rounded-xl border border-ink-700 p-4"
          hidden={state.players.length < 2}
        >
          <h3 className="text-xs tracking-widest text-mist-300 uppercase">Placar geral</h3>
          <ul className="mt-2 space-y-1">
            {state.players.map((player) => (
              <li key={player.id} className="flex justify-between text-sm">
                <span>{player.name}</span>
                <span className="font-semibold num">
                  {player.totalScore.toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {state.error && (
          <p className="rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-sm text-flare-400">
            {state.error}
          </p>
        )}

        {isHost ? (
          <button
            type="button"
            onClick={onNext}
            className="mt-auto rounded-xl bg-beam-500 px-4 py-3 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
          >
            {retry
              ? "Tentar a rodada de novo"
              : isLastRound
                ? state.duel
                  ? "Ver o resultado"
                  : "Ver placar final"
                : "Próxima rodada"}
          </button>
        ) : (
          <p className="mt-auto text-center text-mist-300">
            {retry
              ? "Esperando o anfitrião tentar a rodada de novo…"
              : "Esperando o anfitrião continuar…"}
          </p>
        )}
      </aside>
    </main>
  );
}
