import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_000;

/** Distancia em metros entre dois pontos (formula de haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_ROUND_SCORE = 5000;

/**
 * Pontuacao da rodada: decaimento exponencial sobre a distancia, normalizado
 * pelo "tamanho" do mapa (14.916 km para o mundo inteiro). Erro zero = 5000,
 * metade do planeta = praticamente zero.
 */
export function scoreForDistance(distanceMeters: number, mapSizeKm = 14_916): number {
  const distanceKm = distanceMeters / 1000;
  const score = MAX_ROUND_SCORE * Math.exp((-10 * distanceKm) / mapSizeKm);
  return Math.round(score);
}

/** Formata a distancia de um jeito legivel (m abaixo de 1 km). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString("pt-BR")} km`;
}
