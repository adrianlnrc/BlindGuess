"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadMaps } from "@/lib/maps";
import type { RoomSettings } from "@/lib/types";

type Props = {
  panoId: string;
  settings: Pick<RoomSettings, "allowMove" | "allowPan" | "allowZoom">;
};

/** Panorama do Street View, com os controles que o jogador espera ter. */
export default function StreetView({ panoId, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  /** Onde a rodada começou, para o botão de voltar ao início. */
  const startRef = useRef<{ pano: string; heading: number; pitch: number } | null>(null);

  const [heading, setHeading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

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

        const panorama =
          panoramaRef.current ?? new maps.StreetViewPanorama(containerRef.current, options);
        panoramaRef.current = panorama;

        panorama.setOptions(options);
        panorama.setPano(panoId);

        // Ângulo inicial aleatório: ninguém começa olhando para o mesmo lado.
        const startHeading = Math.random() * 360;
        panorama.setPov({ heading: startHeading, pitch: 0 });
        if (!settings.allowZoom) panorama.setZoom(1);

        startRef.current = { pano: panoId, heading: startHeading, pitch: 0 };
        setHeading(startHeading);

        listener = panorama.addListener("pov_changed", () => {
          setHeading(panorama.getPov().heading ?? 0);
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [panoId, settings.allowMove, settings.allowPan, settings.allowZoom]);

  const lookNorth = useCallback(() => {
    const panorama = panoramaRef.current;
    if (!panorama) return;
    panorama.setPov({ heading: 0, pitch: panorama.getPov().pitch ?? 0 });
  }, []);

  const returnToStart = useCallback(() => {
    const panorama = panoramaRef.current;
    const start = startRef.current;
    if (!panorama || !start) return;

    panorama.setPano(start.pano);
    panorama.setPov({ heading: start.heading, pitch: start.pitch });
    if (settings.allowZoom) panorama.setZoom(1);
  }, [settings.allowZoom]);

  const nudgeZoom = useCallback((delta: number) => {
    const panorama = panoramaRef.current;
    if (!panorama) return;
    const next = Math.max(0, Math.min(4, (panorama.getZoom() ?? 1) + delta));
    panorama.setZoom(next);
  }, []);

  return (
    <div className="relative size-full bg-ink-900">
      <div ref={containerRef} className="size-full" />

      {/* Sem pan: uma camada transparente engole o arrasto do mouse. */}
      {!settings.allowPan && <div className="absolute inset-0 cursor-not-allowed" />}

      {/* Controles do panorama, fora do caminho do mini-mapa. */}
      <div className="absolute bottom-4 left-4 flex flex-col items-center gap-3">
        <Compass heading={heading} onClick={lookNorth} />

        <div className="flex flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-950/85 backdrop-blur">
          <ControlButton label="Voltar ao ponto inicial" onClick={returnToStart}>
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path
                d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
                fill="currentColor"
              />
            </svg>
          </ControlButton>

          {settings.allowZoom && (
            <>
              <span className="h-px bg-ink-700" />
              <ControlButton label="Aproximar" onClick={() => nudgeZoom(1)}>
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                  <path d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5z" fill="currentColor" />
                </svg>
              </ControlButton>
              <span className="h-px bg-ink-700" />
              <ControlButton label="Afastar" onClick={() => nudgeZoom(-1)}>
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                  <path d="M5 11h14v2H5z" fill="currentColor" />
                </svg>
              </ControlButton>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 grid place-content-center gap-2 p-8 text-center">
          <p className="text-lg font-semibold text-rose-signal">Não deu para carregar o panorama</p>
          <p className="max-w-md text-mist-300">{error}</p>
        </div>
      )}
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-10 place-content-center text-mist-300 transition hover:bg-ink-800 hover:text-beam-400"
    >
      {children}
    </button>
  );
}

/** Bússola: a agulha acompanha para onde o jogador está olhando. */
function Compass({ heading, onClick }: { heading: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Olhar para o norte"
      aria-label="Olhar para o norte"
      className="rounded-full border border-ink-600 bg-ink-950/85 p-1 backdrop-blur transition hover:border-beam-500"
    >
      <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
        <circle cx="24" cy="24" r="21" fill="none" stroke="#1e2a40" strokeWidth="1.5" />

        {/* marcas dos quatro pontos cardeais, girando com a câmera */}
        <g transform={`rotate(${-heading} 24 24)`}>
          {[0, 90, 180, 270].map((angle) => (
            <line
              key={angle}
              x1="24"
              y1="5"
              x2="24"
              y2={angle === 0 ? 9 : 8}
              stroke={angle === 0 ? "#f4628a" : "#2c3a54"}
              strokeWidth={angle === 0 ? 2 : 1.5}
              strokeLinecap="round"
              transform={`rotate(${angle} 24 24)`}
            />
          ))}

          {/* agulha: metade vermelha para o norte, metade clara para o sul */}
          <path d="M24 11l4.5 13H19.5z" fill="#f4628a" />
          <path d="M24 37l-4.5-13h9z" fill="#93a2bd" />
        </g>

        <circle cx="24" cy="24" r="2.4" fill="#0d131f" stroke="#2c3a54" strokeWidth="1" />
      </svg>
    </button>
  );
}
