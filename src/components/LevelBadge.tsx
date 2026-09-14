"use client";

import { levelInfo } from "@/lib/level";

type Props = { xp: number; size?: number; showProgress?: boolean };

/** Nivel do jogador num anel de progresso ate o proximo. */
export default function LevelBadge({ xp, size = 44, showProgress = true }: Props) {
  const info = levelInfo(xp);
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * info.progress;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
          <circle cx="20" cy="20" r={radius} fill="none" stroke="#1e2a40" strokeWidth="3.5" />
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke="#35d6a4"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            transform="rotate(-90 20 20)"
          />
        </svg>
        <span
          className="absolute inset-0 grid place-content-center font-bold tabular-nums"
          style={{ fontSize: size * 0.4 }}
        >
          {info.level}
        </span>
      </div>

      {showProgress && (
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Nível {info.level}</p>
          <p className="text-sm text-mist-300">
            faltam{" "}
            <strong className="text-mist-100 tabular-nums">
              {info.toNextLevel.toLocaleString("pt-BR")}
            </strong>{" "}
            pts
          </p>
        </div>
      )}
    </div>
  );
}
