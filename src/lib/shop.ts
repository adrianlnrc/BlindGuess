import type { FaceId, GameMode, HatId } from "./types";

export type ShopItem = {
  id: string;
  kind: "hat" | "face" | "outfit" | "accent";
  /** Valor aplicado no avatar quando o item esta equipado. */
  value: string;
  label: string;
  price: number;
};

/** Itens que todo mundo ja tem, sem passar pela loja. */
export const FREE_HATS: HatId[] = ["none", "cap", "explorer", "beanie", "headphones"];
export const FREE_FACES: FaceId[] = ["smile", "focused", "glasses", "shades"];
export const FREE_OUTFITS = ["#16b886", "#4f8df9", "#f4628a", "#ffb454", "#a86ff0", "#e2e8f0"];
export const FREE_ACCENTS = ["#ffb454", "#35d6a4", "#f4628a", "#6aa8ff", "#facc15", "#0d131f"];

/** Catalogo da loja. O id e o que fica guardado no banco. */
export const SHOP_ITEMS: ShopItem[] = [
  { id: "hat_bucket", kind: "hat", value: "bucket", label: "Chapéu bucket", price: 300 },
  { id: "hat_visor", kind: "hat", value: "visor", label: "Viseira", price: 300 },
  { id: "hat_helmet", kind: "hat", value: "helmet", label: "Capacete", price: 600 },
  { id: "hat_crown", kind: "hat", value: "crown", label: "Coroa", price: 1500 },
  { id: "face_wink", kind: "face", value: "wink", label: "Piscadinha", price: 250 },
  { id: "face_grin", kind: "face", value: "grin", label: "Sorrisão", price: 250 },
  { id: "face_eyepatch", kind: "face", value: "eyepatch", label: "Tapa-olho", price: 700 },
  { id: "outfit_teal", kind: "outfit", value: "#0f766e", label: "Verde profundo", price: 200 },
  { id: "outfit_crimson", kind: "outfit", value: "#9f1239", label: "Carmim", price: 200 },
  { id: "outfit_gold", kind: "outfit", value: "#b8860b", label: "Dourado", price: 800 },
  { id: "accent_ice", kind: "accent", value: "#7dd3fc", label: "Gelo", price: 200 },
  { id: "accent_magma", kind: "accent", value: "#ea580c", label: "Magma", price: 400 },
];

const BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const BY_VALUE = new Map(SHOP_ITEMS.map((item) => [`${item.kind}:${item.value}`, item]));

export function itemById(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

/** O item da loja que corresponde a uma escolha do avatar, se for pago. */
export function paidItemFor(kind: ShopItem["kind"], value: string): ShopItem | undefined {
  return BY_VALUE.get(`${kind}:${value}`);
}

export function itemsOfKind(kind: ShopItem["kind"]): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.kind === kind);
}

// ------------------------------------------------------------------ moedas

/** Moedas por pais acertado na sequencia. Cinco paises pagam como vencer um duelo. */
export const COINS_POR_PAIS = 8;

/**
 * Moedas ganhas numa partida: uma a cada mil pontos, com bonus por modo.
 * O desafio do dia paga a mais porque so da para jogar uma vez.
 *
 * A sequencia de paises nao tem pontuacao — acerto ou erro —, entao ela paga
 * por pais acertado. Sem isso, um jogo inteiro de sequencia pagaria zero.
 */
export function coinsEarned(input: {
  totalScore: number;
  mode: GameMode;
  isDaily: boolean;
  duelOutcome?: "win" | "loss" | "draw" | null;
  /** So no modo sequencia: quantos paises o jogador acertou seguidos. */
  streakLength?: number;
}): number {
  if (input.mode === "streak") {
    return Math.max(0, Math.floor(input.streakLength ?? 0)) * COINS_POR_PAIS;
  }

  let coins = Math.floor(Math.max(0, input.totalScore) / 1000);

  if (input.isDaily) coins += 25;
  if (input.duelOutcome === "win") coins += 40;
  if (input.duelOutcome === "draw") coins += 15;

  return coins;
}
