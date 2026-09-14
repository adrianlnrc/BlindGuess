"use client";

import GuessMap from "./GuessMap";
import StreetView from "./StreetView";
import { useCountdown } from "@/lib/useRoom";
import type { LatLng, RoomState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  onGuess: (position: LatLng) => void;
};

export default function GameView({ state, playerId, onGuess }: Props) {
  const remaining = useCountdown(state.roundEndsAt);
  const alreadyGuessed = !!playerId && state.submitted.includes(playerId);
  const waiting = state.players.filter((p) => p.connected && !state.submitted.includes(p.id));

  if (!state.panorama) {
    return (
      <main className="grid min-h-dvh place-content-center gap-3 text-center">
        <p className="text-2xl font-semibold">Procurando um lugar no mundo…</p>
        <p className="text-mist-300">Sorteando um panorama válido do Street View.</p>
      </main>
    );
  }

  const lowTime = remaining !== null && remaining <= 15;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <StreetView panoId={state.panorama.panoId} settings={state.settings} />

      {/* HUD superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="panel rounded-xl px-4 py-2.5">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Rodada</p>
          <p className="text-xl font-bold">
            {state.round}
            <span className="text-mist-300">/{state.settings.rounds}</span>
          </p>
        </div>

        {remaining !== null && (
          <div
            className={`panel rounded-xl px-5 py-2.5 text-center ${
              lowTime ? "border-rose-signal/60" : ""
            }`}
          >
            <p className="text-xs tracking-widest text-mist-300 uppercase">Tempo</p>
            <p
              className={`text-2xl font-bold tabular-nums ${lowTime ? "text-rose-signal" : ""}`}
            >
              {formatClock(remaining)}
            </p>
          </div>
        )}

        <div className="panel max-w-48 rounded-xl px-4 py-2.5">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Palpitaram</p>
          <p className="text-xl font-bold">
            {state.submitted.length}
            <span className="text-mist-300">/{state.players.filter((p) => p.connected).length}</span>
          </p>
        </div>
      </div>

      {/* Mapa de palpite */}
      <div className="absolute right-4 bottom-4">
        <GuessMap onConfirm={onGuess} disabled={alreadyGuessed} />
      </div>

      {alreadyGuessed && waiting.length > 0 && (
        <div className="panel absolute bottom-4 left-4 max-w-xs rounded-xl px-4 py-3">
          <p className="text-sm text-mist-300">Esperando:</p>
          <p className="font-medium">{waiting.map((p) => p.name).join(", ")}</p>
        </div>
      )}
    </main>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
