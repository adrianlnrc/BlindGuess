/**
 * Nivel a partir dos pontos acumulados. A curva e quadratica: cada nivel custa
 * um pouco mais que o anterior, entao subir cedo e rapido e depois vira maratona.
 * Nivel 2 em 2.500 pontos, 3 em 10.000, 4 em 22.500, 5 em 40.000.
 */
const STEP = 2_500;

export function xpForLevel(level: number): number {
  return STEP * (level - 1) ** 2;
}

export function levelForXp(xp: number): number {
  // `xp <= 0` e falso para NaN, entao sem esta guarda o nivel sairia NaN e a
  // tela mostraria "Nivel NaN" com a barra de progresso quebrada.
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.floor(Math.sqrt(xp / STEP)) + 1;
}

export type LevelInfo = {
  level: number;
  xp: number;
  /** Pontos no nivel atual e quanto falta para o proximo. */
  intoLevel: number;
  levelSpan: number;
  toNextLevel: number;
  progress: number;
};

export function levelInfo(xp: number): LevelInfo {
  const level = levelForXp(xp);
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const levelSpan = nextXp - floorXp;
  const intoLevel = Math.max(0, xp - floorXp);

  return {
    level,
    xp,
    intoLevel,
    levelSpan,
    toNextLevel: Math.max(0, nextXp - xp),
    progress: levelSpan > 0 ? Math.min(1, intoLevel / levelSpan) : 0,
  };
}
