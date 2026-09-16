"use client";

import Avatar from "./Avatar";
import type { DuelState, Player } from "@/lib/types";

type Props = {
  duel: DuelState;
  players: Player[];
  meId: string | undefined;
  /** Dano da rodada que acabou, para destacar quem levou. */
  hitId?: string | null;
  compact?: boolean;
};

/** Barras de vida dos dois duelistas. */
export default function DuelBars({ duel, players, meId, hitId, compact = false }: Props) {
  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
      {players.map((player) => {
        const hp = duel.hp[player.id] ?? duel.startHp;
        const ratio = Math.max(0, Math.min(1, hp / duel.startHp));
        const low = ratio <= 0.25;
        const hit = hitId === player.id;

        return (
          <div key={player.id} className="flex items-center gap-3">
            <Avatar avatar={player.avatar} size={compact ? 26 : 34} className="rounded-lg" />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {player.name}
                  {player.id === meId && <span className="text-mist-300"> (você)</span>}
                </span>
                <span
                  className={`text-sm font-bold num ${
                    hp <= 0 ? "text-rose-signal" : low ? "text-flare-400" : "text-mist-100"
                  }`}
                >
                  {hp.toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    hp <= 0 ? "bg-rose-signal" : low ? "bg-flare-400" : "bg-beam-500"
                  }`}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </div>

            {hit && (
              <span className="shrink-0 text-sm font-bold text-rose-signal">
                dano
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
