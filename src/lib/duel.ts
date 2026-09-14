/**
 * Regras do duelo 1v1. Cada rodada, quem fica mais longe do local perde vida
 * pela diferenca de pontos entre os dois, multiplicada pelo fator da rodada.
 * Empate nao tira vida de ninguem. Acaba quando alguem zera.
 */

export const DUEL_START_HP = 6000;

/** Teto de seguranca: dois jogadores muito parecidos poderiam durar para sempre. */
export const DUEL_MAX_ROUNDS = 25;

/** O dano cresce com o tempo, para o duelo nao se arrastar. */
export function duelMultiplier(round: number): number {
  if (round <= 2) return 1;
  if (round <= 4) return 1.5;
  if (round <= 6) return 2;
  return 3;
}

export type DuelDamage = {
  playerId: string;
  amount: number;
  multiplier: number;
} | null;

/** Quem perde vida na rodada e quanto. */
export function damageFor(
  round: number,
  scores: { playerId: string; score: number }[],
): DuelDamage {
  if (scores.length !== 2) return null;

  const [a, b] = scores;
  if (a.score === b.score) return null;

  const loser = a.score < b.score ? a : b;
  const diff = Math.abs(a.score - b.score);
  const multiplier = duelMultiplier(round);

  return { playerId: loser.playerId, amount: Math.round(diff * multiplier), multiplier };
}
