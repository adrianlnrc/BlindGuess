import { mapById, type Difficulty } from "@/lib/catalog";
import type { LatLng, RegionId } from "@/lib/types";

export type PickedLocation = LatLng & { panoId: string };

/**
 * Pontos-semente por regiao. Cada sorteio pega uma semente, aplica um desvio
 * aleatorio e pede ao Street View o panorama mais proximo dentro do raio de
 * busca. Sementes espalhadas dao variedade sem cair no meio do oceano.
 */
const SEEDS: Record<Exclude<RegionId, "world">, LatLng[]> = {
  brazil: [
    { lat: -23.5505, lng: -46.6333 }, { lat: -22.9068, lng: -43.1729 },
    { lat: -15.7939, lng: -47.8828 }, { lat: -19.9167, lng: -43.9345 },
    { lat: -30.0346, lng: -51.2177 }, { lat: -25.4284, lng: -49.2733 },
    { lat: -12.9777, lng: -38.5016 }, { lat: -8.0476, lng: -34.877 },
    { lat: -3.7327, lng: -38.527 }, { lat: -1.4558, lng: -48.4902 },
    { lat: -3.119, lng: -60.0217 }, { lat: -16.6869, lng: -49.2648 },
    { lat: -20.4697, lng: -54.6201 }, { lat: -27.5954, lng: -48.548 },
    { lat: -9.6658, lng: -35.7353 }, { lat: -5.7945, lng: -35.211 },
    { lat: -21.7642, lng: -43.3496 }, { lat: -22.2171, lng: -49.9501 },
    { lat: -29.6842, lng: -53.8069 }, { lat: -10.9472, lng: -37.0731 },
    { lat: -2.5297, lng: -44.3028 }, { lat: -7.115, lng: -34.8631 },
    { lat: -24.0058, lng: -46.4025 }, { lat: -18.9186, lng: -48.2772 },
  ],
  europe: [
    { lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 },
    { lat: 52.52, lng: 13.405 }, { lat: 41.9028, lng: 12.4964 },
    { lat: 40.4168, lng: -3.7038 }, { lat: 52.3676, lng: 4.9041 },
    { lat: 59.3293, lng: 18.0686 }, { lat: 55.6761, lng: 12.5683 },
    { lat: 47.4979, lng: 19.0402 }, { lat: 50.0755, lng: 14.4378 },
    { lat: 38.7223, lng: -9.1393 }, { lat: 53.3498, lng: -6.2603 },
    { lat: 60.1699, lng: 24.9384 }, { lat: 45.815, lng: 15.9819 },
    { lat: 37.9838, lng: 23.7275 }, { lat: 46.0569, lng: 14.5058 },
    { lat: 44.4268, lng: 26.1025 }, { lat: 42.6977, lng: 23.3219 },
    { lat: 46.9481, lng: 7.4474 }, { lat: 48.2082, lng: 16.3738 },
    { lat: 63.4305, lng: 10.3951 }, { lat: 64.1466, lng: -21.9426 },
    { lat: 43.7696, lng: 11.2558 }, { lat: 41.3851, lng: 2.1734 },
  ],
  americas: [
    { lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 },
    { lat: 41.8781, lng: -87.6298 }, { lat: 29.7604, lng: -95.3698 },
    { lat: 39.7392, lng: -104.9903 }, { lat: 47.6062, lng: -122.3321 },
    { lat: 43.6532, lng: -79.3832 }, { lat: 49.2827, lng: -123.1207 },
    { lat: 45.5019, lng: -73.5674 }, { lat: 19.4326, lng: -99.1332 },
    { lat: 20.6597, lng: -103.3496 }, { lat: 9.9281, lng: -84.0907 },
    { lat: 8.9824, lng: -79.5199 }, { lat: 4.711, lng: -74.0721 },
    { lat: -12.0464, lng: -77.0428 }, { lat: -33.4489, lng: -70.6693 },
    { lat: -34.6037, lng: -58.3816 }, { lat: -34.9011, lng: -56.1645 },
    { lat: -25.2637, lng: -57.5759 }, { lat: -16.4897, lng: -68.1193 },
    { lat: 10.4806, lng: -66.9036 }, { lat: 25.7617, lng: -80.1918 },
    { lat: 61.2181, lng: -149.9003 }, { lat: 21.3069, lng: -157.8583 },
  ],
  asia: [
    { lat: 35.6762, lng: 139.6503 }, { lat: 37.5665, lng: 126.978 },
    { lat: 13.7563, lng: 100.5018 }, { lat: 1.3521, lng: 103.8198 },
    { lat: 3.139, lng: 101.6869 }, { lat: -6.2088, lng: 106.8456 },
    { lat: 14.5995, lng: 120.9842 }, { lat: 28.6139, lng: 77.209 },
    { lat: 19.076, lng: 72.8777 }, { lat: 12.9716, lng: 77.5946 },
    { lat: 6.9271, lng: 79.8612 }, { lat: 27.7172, lng: 85.324 },
    { lat: 25.033, lng: 121.5654 }, { lat: 22.3193, lng: 114.1694 },
    { lat: 41.0082, lng: 28.9784 }, { lat: 25.2048, lng: 55.2708 },
    { lat: 24.7136, lng: 46.6753 }, { lat: 31.7683, lng: 35.2137 },
    { lat: 43.2389, lng: 76.8897 }, { lat: 47.8864, lng: 106.9057 },
    { lat: 34.6937, lng: 135.5023 }, { lat: 10.8231, lng: 106.6297 },
    { lat: 21.0278, lng: 105.8342 }, { lat: 33.6844, lng: 73.0479 },
  ],
  africa: [
    { lat: -33.9249, lng: 18.4241 }, { lat: -26.2041, lng: 28.0473 },
    { lat: -29.8587, lng: 31.0218 }, { lat: -1.2921, lng: 36.8219 },
    { lat: -6.7924, lng: 39.2083 }, { lat: 0.3476, lng: 32.5825 },
    { lat: 5.6037, lng: -0.187 }, { lat: 6.5244, lng: 3.3792 },
    { lat: 14.7167, lng: -17.4677 }, { lat: 33.5731, lng: -7.5898 },
    { lat: 36.8065, lng: 10.1815 }, { lat: 30.0444, lng: 31.2357 },
    { lat: -22.5609, lng: 17.0658 }, { lat: -24.6282, lng: 25.9231 },
    { lat: -20.1609, lng: 57.5012 }, { lat: -18.8792, lng: 47.5079 },
    { lat: 9.0192, lng: 38.7525 }, { lat: -4.4419, lng: 15.2663 },
    { lat: 12.6392, lng: -8.0029 }, { lat: 31.6295, lng: -7.9811 },
    { lat: -15.3875, lng: 28.3228 }, { lat: -17.8252, lng: 31.0335 },
  ],
  oceania: [
    { lat: -33.8688, lng: 151.2093 }, { lat: -37.8136, lng: 144.9631 },
    { lat: -27.4698, lng: 153.0251 }, { lat: -31.9505, lng: 115.8605 },
    { lat: -34.9285, lng: 138.6007 }, { lat: -42.8821, lng: 147.3272 },
    { lat: -12.4634, lng: 130.8456 }, { lat: -23.6980, lng: 133.8807 },
    { lat: -36.8485, lng: 174.7633 }, { lat: -41.2865, lng: 174.7762 },
    { lat: -43.5321, lng: 172.6362 }, { lat: -45.8788, lng: 170.5028 },
    { lat: -17.7134, lng: 178.0650 }, { lat: -9.4438, lng: 147.1803 },
    { lat: -21.1789, lng: -175.1982 }, { lat: -13.8333, lng: -171.7667 },
    { lat: -22.2758, lng: 166.4580 }, { lat: -19.0554, lng: 178.4417 },
    { lat: -35.2809, lng: 149.1300 }, { lat: -28.0167, lng: 153.4000 },
  ],
  world_rural: [
    { lat: -13.5, lng: -56.1 }, { lat: -9.9, lng: -63.3 },
    { lat: 46.8, lng: -100.8 }, { lat: 41.6, lng: -109.2 },
    { lat: 52.1, lng: -106.6 }, { lat: 62.0, lng: 15.5 },
    { lat: 65.0, lng: 25.5 }, { lat: 55.8, lng: 49.1 },
    { lat: 50.4, lng: 30.5 }, { lat: 45.9, lng: 24.9 },
    { lat: 39.5, lng: -5.9 }, { lat: 43.3, lng: 17.8 },
    { lat: -31.4, lng: -64.2 }, { lat: -38.0, lng: -63.6 },
    { lat: -22.9, lng: -50.5 }, { lat: -6.3, lng: 106.0 },
    { lat: 14.1, lng: 100.9 }, { lat: 27.5, lng: 78.5 },
    { lat: 36.5, lng: 138.2 }, { lat: -29.1, lng: 26.2 },
    { lat: -25.7, lng: 28.2 }, { lat: -31.0, lng: 145.0 },
    { lat: -41.0, lng: 173.0 }, { lat: 60.5, lng: -135.0 },
    { lat: 49.0, lng: 2.9 }, { lat: 53.5, lng: -2.5 },
  ],
  famous: [
    { lat: 48.8584, lng: 2.2945 }, { lat: 40.4319, lng: 116.5704 },
    { lat: 27.1751, lng: 78.0421 }, { lat: -13.1631, lng: -72.545 },
    { lat: -22.9519, lng: -43.2105 }, { lat: 29.9792, lng: 31.1342 },
    { lat: 41.8902, lng: 12.4922 }, { lat: 37.8199, lng: -122.4783 },
    { lat: -33.8568, lng: 151.2153 }, { lat: 51.5007, lng: -0.1246 },
    { lat: 36.1069, lng: -112.1129 }, { lat: 35.3606, lng: 138.7274 },
    { lat: 43.0828, lng: -79.0742 }, { lat: -25.3444, lng: 131.0369 },
    { lat: 64.9631, lng: -19.0208 }, { lat: 46.5348, lng: 7.9626 },
    { lat: 55.7539, lng: 37.6208 }, { lat: 40.6892, lng: -74.0445 },
    { lat: -1.2921, lng: 36.8219 }, { lat: -33.9249, lng: 18.4241 },
    { lat: 30.3285, lng: 35.4444 }, { lat: 20.6843, lng: -88.5678 },
    { lat: 37.9715, lng: 23.7257 }, { lat: 78.2232, lng: 15.6267 },
  ],
};

const WORLD_SEEDS: LatLng[] = Object.values(SEEDS).flat();

function seedsFor(region: RegionId): LatLng[] {
  return region === "world" ? WORLD_SEEDS : SEEDS[region];
}

/**
 * A dificuldade muda o quao longe da semente o sorteio pode cair e o raio de
 * busca do panorama. Mapa facil cai perto de cidade; dificil joga voce numa
 * estrada rural, onde nao ha placa nem ponto de referencia.
 */
const SEARCH: Record<Difficulty, { jitterDeg: number; radiusM: number }> = {
  facil: { jitterDeg: 0.15, radiusM: 10_000 },
  medio: { jitterDeg: 0.5, radiusM: 20_000 },
  dificil: { jitterDeg: 1.6, radiusM: 60_000 },
};

type MetadataResponse = {
  status: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
};

/** O jitter pode empurrar a semente para fora dos limites do globo. */
function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

async function lookupPanorama(
  point: LatLng,
  apiKey: string,
  radiusM: number,
): Promise<PickedLocation | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  url.searchParams.set("location", `${point.lat},${point.lng}`);
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("source", "outdoor");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = (await res.json()) as MetadataResponse;
  if (data.status !== "OK" || !data.pano_id || !data.location) return null;

  return { panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng };
}

/**
 * Sorteia uma localizacao valida na regiao pedida. Tenta varias sementes ate
 * achar um panorama; devolve null se a API nao responder (sem chave, cota, etc).
 */
export async function pickLocation(
  region: RegionId,
  attempts = 12,
  exclude: Set<string> = new Set(),
): Promise<PickedLocation | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const seeds = seedsFor(region);
  const search = SEARCH[mapById(region)?.difficulty ?? "medio"];

  for (let i = 0; i < attempts; i++) {
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    const point: LatLng = {
      lat: clampLat(seed.lat + (Math.random() * 2 - 1) * search.jitterDeg),
      lng: wrapLng(seed.lng + (Math.random() * 2 - 1) * search.jitterDeg),
    };

    try {
      const found = await lookupPanorama(point, apiKey, search.radiusM);
      if (found && !exclude.has(found.panoId)) return found;
    } catch {
      // timeout ou rede: tenta a proxima semente
    }
  }

  return null;
}
