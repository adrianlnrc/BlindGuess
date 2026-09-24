/**
 * Enquadramento do provador — só números, sem Three.js, para poder ser lido
 * pela tela sem arrastar o pacote 3D.
 *
 * O personagem tem os pés no y = 0 e o topo da cabeça em ~2,30 (`ALTURA`). O
 * chapéu mais alto do catálogo é o gorro: o pompom chega a ~2,57; a coroa vai
 * a ~2,46. O enquadramento de corpo inteiro tem de caber isso **com folga**,
 * senão o provador corta justamente o item que está sendo provado.
 */

export type Enquadramento = "corpo" | "rosto";

/** Topo do chapéu mais alto (gorro), já com a folga de segurança. */
export const TOPO_COM_CHAPEU = 2.57;

/** Abertura vertical da câmera, em graus. */
export const FOV = 32;

/**
 * Cada enquadramento é uma altura de mira e uma meia-altura visível. A câmera
 * fica **na altura da mira**, olhando na horizontal: nada de plano de cima.
 *
 * - `corpo`: mira na cintura alta, mostra do chão até 2,80 — 0,23 de folga
 *   acima do gorro, que é o mais alto de todos.
 * - `rosto`: mira na cabeça e chega perto, para os sete rostos e os nove
 *   chapéus — onde mora a maior parte da loja — lerem de verdade. Mostra de
 *   0,73 a 2,83, ou seja, ainda pega o tronco: roupa e detalhe continuam à
 *   vista, e sobra folga acima do gorro.
 */
export const ENQUADRAMENTO: Record<Enquadramento, { alvo: number; meiaAltura: number }> = {
  corpo: { alvo: 1.3, meiaAltura: 1.5 },
  rosto: { alvo: 1.78, meiaAltura: 1.05 },
};

/** Distância da câmera que faz a meia-altura pedida caber no `FOV`. */
export function distanciaCamera(meiaAltura: number): number {
  return meiaAltura / Math.tan(((FOV / 2) * Math.PI) / 180);
}
