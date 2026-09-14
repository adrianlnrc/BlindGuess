"use client";

import { useEffect, useRef } from "react";
import { DARK_MAP_STYLE, loadMaps } from "@/lib/maps";
import type { Guess, LatLng } from "@/lib/types";

const PLAYER_COLORS = [
  "#35d6a4", "#ffb454", "#f4628a", "#6aa8ff", "#c084fc", "#facc15",
  "#38bdf8", "#fb923c", "#4ade80", "#f472b6", "#a3e635", "#22d3ee",
];

/** Mapa com o local real e uma linha ate o palpite de cada jogador. */
export default function ResultMap({ target, guesses }: { target: LatLng; guesses: Guess[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    loadMaps().then((maps) => {
      if (cancelled || !containerRef.current) return;

      const map = new maps.Map(containerRef.current, {
        center: target,
        zoom: 3,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        styles: DARK_MAP_STYLE,
      });

      new maps.Marker({
        position: target,
        map,
        title: "Local real",
        icon: {
          path: maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 7,
          fillColor: "#ffffff",
          fillOpacity: 1,
          strokeColor: "#080c14",
          strokeWeight: 2,
        },
        zIndex: 999,
      });

      const bounds = new maps.LatLngBounds();
      bounds.extend(target);

      guesses.forEach((guess, index) => {
        const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

        new maps.Marker({
          position: guess.position,
          map,
          title: guess.playerName,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#080c14",
            strokeWeight: 2,
          },
        });

        new maps.Polyline({
          map,
          path: [guess.position, target],
          strokeColor: color,
          strokeOpacity: 0.7,
          strokeWeight: 2,
        });

        bounds.extend(guess.position);
      });

      if (guesses.length > 0) map.fitBounds(bounds, 64);
    });

    return () => {
      cancelled = true;
    };
  }, [target, guesses]);

  return <div ref={containerRef} className="size-full" />;
}

export { PLAYER_COLORS };
