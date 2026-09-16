"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DARK_MAP_STYLE, loadMaps } from "@/lib/maps";
import type { LatLng } from "@/lib/types";

type Props = {
  onConfirm: (position: LatLng) => void;
  disabled: boolean;
};

/** Passos de tamanho do mini-mapa, do canto discreto ao quase tela cheia. */
const SIZES = [
  { box: "h-44 w-64 sm:h-52 sm:w-80", label: "Pequeno" },
  { box: "h-64 w-96 sm:h-80 sm:w-[30rem]", label: "Médio" },
  { box: "h-[70vh] w-[min(92vw,54rem)]", label: "Grande" },
] as const;

/**
 * Mini-mapa do palpite. Fica pequeno no canto, cresce quando o mouse chega
 * perto e pode ser fixado num tamanho — o jogador escolhe entre ver o mundo
 * e ver a rua.
 */
export default function GuessMap({ onConfirm, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [guess, setGuess] = useState<LatLng | null>(null);
  const [step, setStep] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Sem fixar, passar o mouse já aumenta um degrau.
  const activeStep = pinned ? step : hovering ? Math.max(step, 1) : step;

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
  }, [activeStep]);

  const confirm = useCallback(() => {
    if (guess && !disabled) onConfirm(guess);
  }, [guess, disabled, onConfirm]);

  // Espaço confirma o palpite sem tirar a mão do mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        event.preventDefault();
        confirm();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`panel flex flex-col overflow-hidden rounded-2xl shadow-2xl transition-all duration-200 ${SIZES[activeStep].box}`}
    >
      <div className="relative flex-1">
        <div ref={containerRef} className="size-full" />

        <div className="absolute top-2 left-2 flex gap-1.5">
          <MapChip
            label={activeStep === SIZES.length - 1 ? "Reduzir o mapa" : "Aumentar o mapa"}
            onClick={() => {
              const next = activeStep === SIZES.length - 1 ? 0 : activeStep + 1;
              setStep(next);
              setPinned(true);
            }}
          >
            {activeStep === SIZES.length - 1 ? "−" : "+"}
          </MapChip>

          <MapChip
            label={pinned ? "Soltar o tamanho" : "Fixar este tamanho"}
            active={pinned}
            onClick={() => {
              setPinned((value) => !value);
              setStep(activeStep);
            }}
          >
            {pinned ? "fixo" : "auto"}
          </MapChip>
        </div>
      </div>

      <div className="p-2">
        <button
          type="button"
          disabled={!guess || disabled}
          onClick={confirm}
          className="w-full rounded-xl bg-beam-500 px-4 py-2.5 font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-300"
        >
          {disabled ? (
            "Palpite enviado"
          ) : guess ? (
            <span className="flex items-center justify-center gap-2">
              Confirmar palpite
              <kbd className="rounded border border-ink-950/25 px-1.5 py-0.5 text-[11px] font-medium">
                espaço
              </kbd>
            </span>
          ) : (
            "Clique no mapa para palpitar"
          )}
        </button>
      </div>
    </div>
  );
}

function MapChip({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg border px-2 py-1 text-xs font-medium backdrop-blur transition ${
        active
          ? "border-beam-500 bg-beam-500/15 text-beam-400"
          : "border-ink-600 bg-ink-950/80 text-mist-300 hover:text-beam-400"
      }`}
    >
      {children}
    </button>
  );
}
