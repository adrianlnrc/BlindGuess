"use client";

import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import type { DailyInfo } from "@/lib/types";

type Props = {
  daily: DailyInfo | null;
  error: string | null;
  loading: boolean;
  disabled: boolean;
  onPlay: () => void;
};

/**
 * Desafio do dia: os mesmos cinco lugares para todo mundo, uma tentativa só,
 * zerando na virada do dia.
 */
export default function DailyCard({ daily, error, loading, disabled, onPlay }: Props) {
  const remaining = useResetCountdown(daily?.resetsAt ?? null);

  return (
    <section className="panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-700 px-6 py-4">
        <div>
          <h2 className="text-xl font-bold">Desafio do dia</h2>
          <p className="text-sm text-mist-300">
            Os mesmos lugares para todo mundo. Uma tentativa só.
          </p>
        </div>
        {remaining && (
          <span className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-mist-300">
            novo em <strong className="text-mist-100 tabular-nums">{remaining}</strong>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 px-6 py-5">
        {error ? (
          <p className="text-flare-400">{error}</p>
        ) : loading || !daily ? (
          <p className="text-mist-300">Preparando o desafio de hoje…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-mist-300">{daily.rounds} rodadas · mundo todo</span>
              {daily.alreadyPlayed && daily.myScore !== null && (
                <span className="rounded-lg bg-beam-500/10 px-3 py-1.5 text-sm font-semibold text-beam-400 tabular-nums">
                  sua marca: {daily.myScore.toLocaleString("pt-BR")}
                </span>
              )}
            </div>

            {daily.topEntries.length > 0 && (
              <ol className="flex flex-col gap-1.5">
                {daily.topEntries.map((entry, index) => (
                  <li key={entry.profileId} className="flex items-center gap-2.5 text-sm">
                    <span className="w-4 text-center text-mist-300 tabular-nums">{index + 1}</span>
                    <Avatar avatar={entry.avatar} size={22} className="rounded-md" />
                    <span className="flex-1 truncate">{entry.name}</span>
                    <span className="font-semibold text-beam-400 tabular-nums">
                      {entry.totalScore.toLocaleString("pt-BR")}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <button
              type="button"
              onClick={onPlay}
              disabled={disabled || daily.alreadyPlayed}
              className="rounded-xl bg-flare-400 px-4 py-3 font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-300"
            >
              {daily.alreadyPlayed ? "Você já jogou hoje" : "Jogar o desafio de hoje"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Tempo restante ate a virada do dia, no formato 5h 12min. */
function useResetCountdown(resetsAt: number | null): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!resetsAt) {
      setLabel(null);
      return;
    }

    const tick = () => {
      const ms = Math.max(0, resetsAt - Date.now());
      const hours = Math.floor(ms / 3_600_000);
      const minutes = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`);
    };

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [resetsAt]);

  return label;
}
