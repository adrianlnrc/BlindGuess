/**
 * Fachada do personagem 3D.
 *
 * Só o embrulho tardio sai daqui: importar este módulo **não** arrasta o
 * Three.js para o bundle. Quem monta a própria cena pega o mesh com
 * `carregaPersonagem()` ou importa `./Personagem` dentro de um `next/dynamic`.
 */

export { default as Personagem3D } from "./Personagem3D";
export type { Personagem3DProps } from "./Personagem3D";
export { temWebGL } from "./webgl";
export { ALTURA, R_CABECA, Y_CABECA } from "./medidas";

/** Carrega o mesh do personagem sob demanda (`const { default: Personagem } = await carregaPersonagem()`). */
export const carregaPersonagem = () => import("./Personagem");

/** Carrega a cena pronta com câmera e luzes, sob demanda. */
export const carregaPersonagemCanvas = () => import("./PersonagemCanvas");
