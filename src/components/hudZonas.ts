/**
 * As âncoras do HUD da tela de jogo, num lugar só.
 *
 * Três componentes desenham por cima do panorama sem se conhecerem — o HUD e o
 * painel "Esperando" (`GameView`), a bússola e os controles da câmera
 * (`StreetView`) e a bolha do chat (`ChatSala`, montada na página da sala). Já
 * houve colisão de verdade aqui: "Esperando" e a bússola moravam ambos em
 * `bottom-4 left-4`, e depois de palpitar o painel cobria a bússola.
 *
 * Enquanto cada arquivo carregava o seu próprio recuo, mexer num deles
 * quebrava os outros em silêncio. Aqui as folgas ficam juntas, de forma que
 * mover uma coisa seja uma edição, não três.
 *
 * O mapa da tela:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Rodada        Tempo        Palpitaram/Duelo │  ALTO
 *   │ [chat, no celular]                          │
 *   │ Esperando                                   │
 *   │                                             │
 *   │ bússola                                     │
 *   │ controles                          mini-mapa│  BAIXO
 *   │ [chat, no desktop]                          │
 *   └─────────────────────────────────────────────┘
 *
 * O mini-mapa tem o canto de baixo à direita só para ele: ele cresce para a
 * esquerda e para cima quando o jogador aumenta, então nada mora ali.
 */

/**
 * Onde a bolha do chat ancora. No desktop fica embaixo à esquerda, depois da
 * coluna da câmera; no celular sobe para o alto, porque aberta lá embaixo
 * cobriria justamente o mini-mapa e o botão de confirmar.
 */
export const ZONA_CHAT = "fixed inset-x-2 top-24 z-40 sm:inset-x-auto sm:top-auto sm:bottom-3 sm:left-20";

/**
 * Coluna da câmera (bússola, controles, atalhos). No desktop ela sobe para
 * deixar livres os ~56px de baixo à esquerda que são da bolha do chat; no
 * celular o chat está no alto e o canto de baixo é todo dela.
 */
export const ZONA_CAMERA = "absolute bottom-4 left-4 flex flex-col items-center gap-3 sm:bottom-20";

/**
 * O painel "Esperando", pendurado sob o painel "Rodada". No celular ele desce
 * o suficiente para passar por baixo da faixa do chat; empilhá-lo na linha de
 * cima não era opção, porque a largura dele empurrava "Palpitaram" para fora
 * da tela em 390px.
 */
export const ZONA_ESPERANDO = "panel absolute top-full left-0 mt-[4.5rem] max-w-56 rounded-xl px-4 py-3 sm:mt-3";
