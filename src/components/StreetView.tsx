"use client";

import { useEffect, useRef, useState } from "react";
import { loadMaps } from "@/lib/maps";
import type { RoomSettings } from "@/lib/types";

type Props = {
  panoId: string;
  settings: Pick<RoomSettings, "allowMove" | "allowPan" | "allowZoom">;
};

/** Panorama do Street View travado nas regras da sala. */
export default function StreetView({ panoId, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const options: google.maps.StreetViewPanoramaOptions = {
          pano: panoId,
          disableDefaultUI: true,
          showRoadLabels: false,
          clickToGo: settings.allowMove,
          linksControl: settings.allowMove,
          scrollwheel: settings.allowZoom,
          motionTracking: false,
          motionTrackingControl: false,
        };

        panoramaRef.current ??= new maps.StreetViewPanorama(containerRef.current, options);
        panoramaRef.current.setOptions(options);
        panoramaRef.current.setPano(panoId);
        // Angulo inicial aleatorio: ninguem comeca olhando para o mesmo lado.
        panoramaRef.current.setPov({ heading: Math.random() * 360, pitch: 0 });
        if (!settings.allowZoom) panoramaRef.current.setZoom(1);
      })
      .catch((err: Error) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [panoId, settings.allowMove, settings.allowPan, settings.allowZoom]);

  return (
    <div className="relative size-full bg-ink-900">
      <div ref={containerRef} className="size-full" />

      {/* Sem pan: uma camada transparente engole o arrasto do mouse. */}
      {!settings.allowPan && <div className="absolute inset-0 cursor-not-allowed" />}

      {error && (
        <div className="absolute inset-0 grid place-content-center gap-2 p-8 text-center">
          <p className="text-lg font-semibold text-rose-signal">Não deu para carregar o panorama</p>
          <p className="max-w-md text-mist-300">{error}</p>
        </div>
      )}
    </div>
  );
}
