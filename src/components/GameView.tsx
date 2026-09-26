"use client";

import DuelBars from "./DuelBars";
import GuessMap from "./GuessMap";
import { ZONA_ESPERANDO } from "./hudZonas";
import StreetView from "./StreetView";
import { useCountdown } from "@/lib/useRoom";
import type { LatLng, RoomState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  onGuess: (position: LatLng) => void;
};

/**
 * Este arquivo desenha o alto da tela: rodada, cronômetro, "Palpitaram"/duelo e
 * o painel "Esperando". Os outros cantos são de `StreetView.tsx` (câmera),
 * `GuessMap.tsx` (mini-mapa) e `ChatSala.tsx` (chat) — as âncoras e as folgas
 * entre eles vivem em `hudZonas.ts`, e é lá que se mexe.
 */
export default function GameView({ state, playerId, onGuess }: Props) {
  const remaining = useCountdown(state.roundEndsAt);
  const alreadyGuessed = !!playerId && state.submitted.includes(playerId);
  const waiting = state.players.filter((p) => p.connected && !state.submitted.includes(p.id));

  if (!state.panorama) {
    const search = state.locationSearch;
    return (
      <main className="grid min-h-dvh place-content-center gap-3 px-6 text-center">
        <p className="text-2xl font-semibold">Procurando um lugar no mundo…</p>
        <p className="text-mist-300">
          {search && search.attempt > 1
            ? `Não deu de primeira — tentativa ${search.attempt} de ${search.maxAttempts}.`
            : "Sorteando um panorama válido do Street View."}
        </p>
        {state.error && (
          <p className="mx-auto max-w-md rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-sm text-flare-400">
            {state.error}
          </p>
        )}
      </main>
    );
  }

  const lowTime = remaining !== null && remaining <= 15;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <StreetView panoId={state.panorama.panoId} settings={state.settings} />

      {/* HUD superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        {/* Coluna da esquerda: a rodada e, pendurado embaixo dela, quem ainda
            falta palpitar — pendurado porque a largura do painel de espera não
            pode espremer o cronômetro e o contador desta mesma linha. */}
        <div className="relative">
          <div className="panel rounded-xl px-4 py-2.5">
            <p className="text-xs tracking-widest text-mist-300 uppercase">Rodada</p>
            <p className="num text-xl">
              {state.round}
              {!state.duel && <span className="text-mist-300">/{state.settings.rounds}</span>}
            </p>
          </div>

          {alreadyGuessed && waiting.length > 0 && (
            <div className={ZONA_ESPERANDO}>
              <p className="text-sm text-mist-300">Esperando:</p>
              <p className="font-medium">{waiting.map((p) => p.name).join(", ")}</p>
            </div>
          )}
        </div>

        {remaining !== null && (
          <div
            className={`panel rounded-xl px-5 py-2.5 text-center ${
              lowTime ? "border-rose-signal/60" : ""
            }`}
          >
            <p className="text-xs tracking-widest text-mist-300 uppercase">Tempo</p>
            <p
              className={`text-2xl font-bold num ${lowTime ? "text-rose-signal" : ""}`}
            >
              {formatClock(remaining)}
            </p>
          </div>
        )}

        {state.duel ? (
          <div className="panel pointer-events-auto w-64 rounded-xl px-4 py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-xs tracking-widest text-mist-300 uppercase">Duelo</p>
              <p className="text-xs font-semibold text-flare-400">
                dano ×{state.duel.multiplier}
              </p>
            </div>
            <DuelBars duel={state.duel} players={state.players} meId={playerId} compact />
          </div>
        ) : (
          <div className="panel max-w-48 rounded-xl px-4 py-2.5">
            <p className="text-xs tracking-widest text-mist-300 uppercase">Palpitaram</p>
            <p className="num text-xl">
              {state.submitted.length}
              <span className="text-mist-300">
                /{state.players.filter((p) => p.connected).length}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Mapa de palpite */}
      <div className="absolute right-4 bottom-4">
        <GuessMap onConfirm={onGuess} disabled={alreadyGuessed} />
      </div>

    </main>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
