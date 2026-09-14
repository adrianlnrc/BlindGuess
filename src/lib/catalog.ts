import type { RegionId } from "./types";

export type Difficulty = "facil" | "medio" | "dificil";

export type MapEntry = {
  id: RegionId;
  label: string;
  hint: string;
  difficulty: Difficulty;
};

/**
 * Catalogo de mapas. A dificuldade nao e so um rotulo: ela muda o quao longe
 * do ponto-semente o sorteio pode cair, entao mapa dificil joga voce em
 * estradas rurais, longe de placas e pontos de referencia.
 */
export const MAPS: MapEntry[] = [
  { id: "famous", label: "Pontos famosos", hint: "lugares icônicos, difícil errar feio", difficulty: "facil" },
  { id: "brazil", label: "Brasil", hint: "só território brasileiro", difficulty: "facil" },
  { id: "europe", label: "Europa", hint: "capitais e estradas europeias", difficulty: "medio" },
  { id: "americas", label: "Américas", hint: "do Alasca à Patagônia", difficulty: "medio" },
  { id: "asia", label: "Ásia", hint: "do Oriente Médio ao Japão", difficulty: "medio" },
  { id: "world", label: "Mundo todo", hint: "qualquer canto do planeta", difficulty: "medio" },
  { id: "africa", label: "África", hint: "cobertura irregular, poucas pistas", difficulty: "dificil" },
  { id: "oceania", label: "Oceania", hint: "ilhas e estradas vazias", difficulty: "dificil" },
  { id: "world_rural", label: "Mundo rural", hint: "estradas de terra e vilarejos, sem placas", difficulty: "dificil" },
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  facil: "Fácil",
  medio: "Médio",
  dificil: "Difícil",
};

export const DIFFICULTY_ORDER: Difficulty[] = ["facil", "medio", "dificil"];

const BY_ID = new Map(MAPS.map((entry) => [entry.id, entry]));

export function mapById(id: RegionId): MapEntry | undefined {
  return BY_ID.get(id);
}

/** Rotulo de um mapa, tolerante a codigos antigos guardados no banco. */
export function mapLabel(id: RegionId | string): string {
  return BY_ID.get(id as RegionId)?.label ?? String(id);
}

export function mapsByDifficulty(difficulty: Difficulty): MapEntry[] {
  return MAPS.filter((entry) => entry.difficulty === difficulty);
}
