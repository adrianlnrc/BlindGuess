"use client";

import { Loader } from "@googlemaps/js-api-loader";

let loader: Loader | null = null;

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** Carrega a Maps JavaScript API uma unica vez por sessao. */
export function loadMaps(): Promise<typeof google.maps> {
  if (!MAPS_API_KEY) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY não configurada."));
  }

  loader ??= new Loader({ apiKey: MAPS_API_KEY, version: "weekly" });
  return Promise.all([loader.importLibrary("maps"), loader.importLibrary("streetView")]).then(
    () => google.maps,
  );
}

/** Estilo escuro do mini-mapa, para combinar com a interface. */
export const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#16202f" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8fa0bb" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d131f" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#2c3a54" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#233149" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1220" }] },
];
