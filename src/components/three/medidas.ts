/**
 * Medidas do personagem 3D, num lugar só.
 *
 * A linguagem vem do bonequinho SVG (`src/components/Avatar.tsx`): cabeça
 * redonda grande, corpo compacto, rosto mínimo. Aqui a cabeça fica com ~44% da
 * altura total — chibi, mas menos extremo que no SVG, para o boneco aguentar
 * ser visto de corpo inteiro numa cena 3D.
 *
 * Origem do personagem: os pés no y = 0, virado para o +z. Quem monta a cena
 * decide onde colocar.
 */

/** Raio da cabeça. */
export const R_CABECA = 0.51;
/** Altura do centro da cabeça. */
export const Y_CABECA = 1.79;
/** Altura total, da sola ao topo da cabeça (sem chapéu). */
export const ALTURA = Y_CABECA + R_CABECA;

/** Distância da frente da cabeça onde o rosto é desenhado, dado x e y. */
export function zRosto(x: number, y: number, recuo = 0.03): number {
  const dentro = R_CABECA * R_CABECA - x * x - y * y;
  return Math.sqrt(Math.max(0.02, dentro)) - recuo;
}
