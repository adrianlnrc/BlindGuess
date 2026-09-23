/**
 * Cola entre o catálogo do servidor (`src/lib/shop.ts`) e as telas de
 * customização. Só leitura: preço, rótulo e o que é grátis continuam vindo de
 * lá, e nada aqui equipa nem debita nada — quem compra é o servidor.
 */

import { FREE_ACCENTS, FREE_FACES, FREE_HATS, FREE_OUTFITS, type ShopItem } from "@/lib/shop";
import type { Avatar, FaceId, HatId } from "@/lib/types";

/** Como o personagem fica com o item vestido — cópia, nunca muta o avatar. */
export function vestir(avatar: Avatar, item: ShopItem): Avatar {
  const proximo = { ...avatar };
  if (item.kind === "hat") proximo.hat = item.value as HatId;
  else if (item.kind === "face") proximo.face = item.value as FaceId;
  else if (item.kind === "outfit") proximo.outfit = item.value;
  else proximo.accent = item.value;
  return proximo;
}

/** O mesmo, para uma escolha solta (cor ou id) em vez de um item da loja. */
export function vestirValor(avatar: Avatar, kind: ShopItem["kind"], value: string): Avatar {
  return vestir(avatar, { id: "", kind, value, label: "", price: 0 });
}

export function moedas(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

export const NOME_DA_SECAO: Record<ShopItem["kind"], string> = {
  hat: "Chapéus",
  face: "Rostos",
  outfit: "Roupas",
  accent: "Detalhes",
};

/** Nomes dos itens que já vêm com todo mundo — o catálogo só nomeia os pagos. */
export const ROTULO_CHAPEU_GRATIS: Record<string, string> = {
  none: "Sem chapéu",
  cap: "Boné",
  explorer: "Explorador",
  beanie: "Gorro",
  headphones: "Fone",
};

export const ROTULO_ROSTO_GRATIS: Record<string, string> = {
  smile: "Sorriso",
  focused: "Concentrado",
  glasses: "Óculos",
  shades: "Escuros",
};

export const ROTULO_COR_GRATIS: Record<string, string> = {
  "#16b886": "Verde",
  "#4f8df9": "Azul",
  "#f4628a": "Rosa",
  "#ffb454": "Âmbar",
  "#a86ff0": "Violeta",
  "#e2e8f0": "Névoa",
  "#35d6a4": "Menta",
  "#6aa8ff": "Céu",
  "#facc15": "Ouro claro",
  "#0d131f": "Tinta",
};

/** Escolhas grátis de cada eixo, na ordem em que aparecem na tela. */
export const GRATIS: Record<ShopItem["kind"], { value: string; label: string }[]> = {
  hat: FREE_HATS.map((id) => ({ value: id, label: ROTULO_CHAPEU_GRATIS[id] ?? id })),
  face: FREE_FACES.map((id) => ({ value: id, label: ROTULO_ROSTO_GRATIS[id] ?? id })),
  outfit: FREE_OUTFITS.map((cor) => ({ value: cor, label: ROTULO_COR_GRATIS[cor] ?? cor })),
  accent: FREE_ACCENTS.map((cor) => ({ value: cor, label: ROTULO_COR_GRATIS[cor] ?? cor })),
};

/** Quanto falta para comprar — 0 quando já dá. */
export function faltam(preco: number, saldo: number): number {
  return Math.max(0, preco - saldo);
}
