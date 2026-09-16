"use client";

import { useEffect, useState } from "react";
import { MAX_ROUND_SCORE, formatDistance } from "@/lib/scoring";

type Props = { score: number; distanceMeters: number };

/**
 * Barra da rodada: os pontos sobem de zero e a barra preenche junto, para o
 * resultado chegar como um evento e nao como um numero ja parado na tela.
 */
export default function ScoreBar({ score, distanceMeters }: Props) {
  const shown = useCountUp(score, 900);
  const ratio = Math.max(0, Math.min(1, score / MAX_ROUND_SCORE));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-3xl font-black tabular-nums text-beam-400">
          {shown.toLocaleString("pt-BR")}
          <span className="ml-1 text-sm font-medium text-mist-300">
            / {MAX_ROUND_SCORE.toLocaleString("pt-BR")}
          </span>
        </span>
        <span className="text-sm text-mist-300">
          errou por <strong className="text-mist-100">{formatDistance(distanceMeters)}</strong>
        </span>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-beam-500 transition-[width] duration-[900ms] ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Conta de zero ate o valor, com desaceleracao no fim. */
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: rapido no comeco, suave ao encostar no numero final.
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
