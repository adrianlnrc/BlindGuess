"use client";

import { useEffect, useRef, useState } from "react";
import { DARK_MAP_STYLE, loadMaps } from "@/lib/maps";
import type { LatLng } from "@/lib/types";

type Props = {
  onConfirm: (position: LatLng) => void;
  disabled: boolean;
};

/** Mini-mapa expansivel onde o jogador crava o palpite. */
export default function GuessMap({ onConfirm, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [guess, setGuess] = useState<LatLng | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadMaps().then((maps) => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maps.Map(containerRef.current, {
        center: { lat: 15, lng: 0 },
        zoom: 1,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        styles: DARK_MAP_STYLE,
        minZoom: 1,
        restriction: {
          latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
          strictBounds: true,
        },
      });

      map.addListener("click", (event: google.maps.MapMouseEvent) => {
        const latLng = event.latLng;
        if (!latLng) return;

        const position = { lat: latLng.lat(), lng: latLng.lng() };
        setGuess(position);

        if (markerRef.current) {
          markerRef.current.setPosition(position);
        } else {
          markerRef.current = new maps.Marker({
            position,
            map,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#35d6a4",
              fillOpacity: 1,
              strokeColor: "#080c14",
              strokeWeight: 2,
            },
          });
        }
      });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // O mapa precisa recalcular o tamanho quando a caixa muda.
  useEffect(() => {
    if (mapRef.current) google.maps.event.trigger(mapRef.current, "resize");
  }, [expanded]);

  const size = expanded
    ? "h-[70vh] w-[min(92vw,900px)]"
    : "h-48 w-72 sm:h-56 sm:w-96 hover:h-[50vh] hover:w-[min(88vw,760px)]";

  return (
    <div
      className={`panel overflow-hidden rounded-2xl shadow-2xl transition-all duration-200 ${size}`}
    >
      <div className="relative size-full">
        <div ref={containerRef} className="size-full" />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute top-2 left-2 rounded-lg border border-ink-600 bg-ink-950/80 px-2 py-1 text-xs font-medium text-mist-300 hover:text-beam-400"
        >
          {expanded ? "Reduzir" : "Ampliar"}
        </button>

        <div className="absolute inset-x-2 bottom-2">
          <button
            type="button"
            disabled={!guess || disabled}
            onClick={() => guess && onConfirm(guess)}
            className="w-full rounded-xl bg-beam-500 px-4 py-2.5 font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-300"
          >
            {disabled
              ? "Palpite enviado"
              : guess
                ? "Confirmar palpite"
                : "Clique no mapa para palpitar"}
          </button>
        </div>
      </div>
    </div>
  );
}
