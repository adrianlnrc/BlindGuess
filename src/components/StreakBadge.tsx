"use client";

import type { StreakInfo } from "@/lib/types";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Ofensiva diaria: numero atual + os ultimos 7 dias. */
export default function StreakBadge({ streak }: { streak: StreakInfo | null }) {
  const current = streak?.current ?? 0;
  const played = new Set(streak?.history ?? []);
  const days = lastSevenDays();
  const alive = current > 0;

  return (
    <div className="panel rounded-2xl px-5 py-4">
      <div className="flex items-center gap-3">
        <span className={`text-3xl ${alive ? "" : "opacity-40 grayscale"}`} aria-hidden>
          🔥
        </span>
        <div>
          <p className="text-2xl font-black tabular-nums">
            {current}
            <span className="ml-1 text-sm font-medium text-mist-300">
              {current === 1 ? "dia" : "dias"}
            </span>
          </p>
          <p className="text-xs text-mist-300">
            {alive ? "ofensiva em andamento" : "jogue hoje para começar"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        {days.map((day) => {
          const active = played.has(day.iso);
          return (
            <div key={day.iso} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-mist-300">{day.label}</span>
              <span
                title={day.iso}
                className={`size-6 rounded-md border ${
                  active
                    ? "border-beam-400 bg-beam-500/30"
                    : "border-ink-600 bg-ink-950/60"
                }`}
              />
            </div>
          );
        })}
      </div>

      {streak && streak.longest > 0 && (
        <p className="mt-3 text-xs text-mist-300">
          Recorde: <strong className="text-mist-100">{streak.longest}</strong>{" "}
          {streak.longest === 1 ? "dia" : "dias"} seguidos
        </p>
      )}
    </div>
  );
}

/** Os ultimos 7 dias terminando hoje, no fuso do navegador. */
function lastSevenDays(): { iso: string; label: string }[] {
  const days: { iso: string; label: string }[] = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    days.push({
      iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      label: WEEKDAYS[date.getDay()],
    });
  }

  return days;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
