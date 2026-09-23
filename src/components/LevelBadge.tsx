"use client";

import { useContagem } from "@/components/ProgressoFeedback";
import { levelInfo } from "@/lib/level";

type Props = {
  xp: number;
  size?: number;
  showProgress?: boolean;
  /**
   * XP de antes do ganho. Quando vem, o anel e o número sobem do valor antigo
   * até o atual — inclusive virando de nível no meio do caminho. Com
   * `prefers-reduced-motion` o valor final aparece direto.
   */
  xpAnterior?: number | null;
  /** Destaca o anel por um instante: acabou de subir de nível. */
  celebrar?: boolean;
};

/**
 * Nível do jogador num anel de progresso até o próximo.
 *
 * O anel é a leitura rápida (quanto do nível já foi) e o texto ao lado é a
 * leitura exata: em que ponto do nível você está e quanto falta. Animar só o XP
 * mostrado basta para tudo se mover junto — anel, número do nível e texto —
 * porque tudo sai de `levelInfo`.
 */
export default function LevelBadge({
  xp,
  size = 44,
  showProgress = true,
  xpAnterior = null,
  celebrar = false,
}: Props) {
  const xpMostrado = useContagem(xp, xpAnterior);
  const info = levelInfo(xpMostrado);
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * info.progress;

  return (
    <div className="flex items-center gap-3">
      <div
        className={`relative shrink-0 rounded-full transition duration-500 ${
          celebrar ? "ring-2 ring-beam-400/70 ring-offset-2 ring-offset-ink-900" : ""
        }`}
        style={{ width: size, height: size }}
        title={`Nível ${info.level} — ${info.intoLevel.toLocaleString("pt-BR")} de ${info.levelSpan.toLocaleString("pt-BR")} pts`}
      >
        <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
          <circle cx="20" cy="20" r={radius} fill="none" stroke="#2b2050" strokeWidth="3.5" />
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            stroke={celebrar ? "#3ce7ad" : "#35d6a4"}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            transform="rotate(-90 20 20)"
          />
        </svg>
        <span
          className="absolute inset-0 grid place-content-center font-bold num"
          style={{ fontSize: size * 0.4 }}
        >
          {info.level}
        </span>
      </div>

      {showProgress && (
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Nível {info.level}</p>
          <p className="text-sm text-mist-300">
            <strong className="text-mist-100 num">{info.intoLevel.toLocaleString("pt-BR")}</strong>
            <span className="num"> / {info.levelSpan.toLocaleString("pt-BR")}</span> pts — faltam{" "}
            <strong className="text-mist-100 num">{info.toNextLevel.toLocaleString("pt-BR")}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
