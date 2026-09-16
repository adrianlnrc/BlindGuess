"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DARK_MAP_STYLE, loadMaps } from "@/lib/maps";
import type { LatLng } from "@/lib/types";

type Props = {
  onConfirm: (position: LatLng) => void;
  disabled: boolean;
};

/** Passos de tamanho do mini-mapa no desktop, do canto discreto ao quase tela cheia. */
const SIZES = [
  { box: "h-44 w-64 sm:h-52 sm:w-80", label: "Pequeno" },
  { box: "h-64 w-96 sm:h-80 sm:w-[30rem]", label: "Médio" },
  { box: "h-[70vh] w-[min(92vw,54rem)]", label: "Grande" },
] as const;

/** Ponteiro de verdade (mouse/trackpad): é o que habilita o hover. */
const PONTEIRO_FINO = "(hover: hover) and (pointer: fine)";

function assinarPonteiro(aviso: () => void) {
  const consulta = window.matchMedia(PONTEIRO_FINO);
  consulta.addEventListener("change", aviso);
  return () => consulta.removeEventListener("change", aviso);
}

/**
 * Diz se o aparelho tem ponteiro fino com hover. É capacidade do ponteiro, não
 * largura de tela: laptop pequeno tem mouse, tablet grande não tem.
 */
function usePonteiroFino() {
  return useSyncExternalStore(
    assinarPonteiro,
    () => window.matchMedia(PONTEIRO_FINO).matches,
    () => true,
  );
}

/**
 * Mini-mapa do palpite.
 *
 * Com mouse: fica pequeno no canto, cresce quando o ponteiro chega perto e pode
 * ser fixado num tamanho — o jogador escolhe entre ver o mundo e ver a rua.
 *
 * No toque (sem hover): o canto vira só uma prévia que não captura gestos; um
 * toque abre o mapa em tela cheia, com zoom, fechar e confirmar ao alcance do
 * polegar.
 */
export default function GuessMap({ onConfirm, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const ponteiroFino = usePonteiroFino();
  const ponteiroFinoRef = useRef(ponteiroFino);
  ponteiroFinoRef.current = ponteiroFino;

  const [guess, setGuess] = useState<LatLng | null>(null);
  const [step, setStep] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Só vale no toque: mapa aberto em tela cheia.
  const [aberto, setAberto] = useState(false);

  // Sem fixar, passar o mouse já aumenta um degrau.
  const activeStep = pinned ? step : hovering ? Math.max(step, 1) : step;
  // Fechado no toque, o mapa é só prévia: gestos passam direto para o panorama.
  const mapaInterativo = ponteiroFino || aberto;

  useEffect(() => {
    let cancelled = false;

    loadMaps().then((maps) => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maps.Map(containerRef.current, {
        center: { lat: 15, lng: 0 },
        zoom: 1,
        disableDefaultUI: true,
        zoomControl: ponteiroFinoRef.current,
        // Um dedo arrasta o mapa em vez de pedir dois dedos.
        gestureHandling: "greedy",
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

  // No toque usamos botões próprios de zoom, grandes o bastante para o dedo.
  useEffect(() => {
    mapRef.current?.setOptions({ zoomControl: ponteiroFino });
  }, [ponteiroFino]);

  // O mapa precisa recalcular o tamanho — e manter o centro — quando a caixa muda.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const centro = map.getCenter();
    google.maps.event.trigger(map, "resize");
    if (centro) map.setCenter(centro);
  }, [activeStep, aberto, ponteiroFino]);

  const confirm = useCallback(() => {
    if (guess && !disabled) {
      onConfirm(guess);
      setAberto(false);
    }
  }, [guess, disabled, onConfirm]);

  // Espaço confirma o palpite sem tirar a mão do mouse; Esc fecha o mapa no toque.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (event.code === "Space") {
        event.preventDefault();
        confirm();
      }

      if (event.code === "Escape") setAberto(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const ajustarZoom = (passo: number) => {
    const map = mapRef.current;
    if (!map) return;
    const atual = map.getZoom();
    if (typeof atual === "number") map.setZoom(atual + passo);
  };

  const caixa = ponteiroFino
    ? `panel rounded-2xl shadow-2xl transition-all duration-200 ${SIZES[activeStep].box}`
    : aberto
      ? "fixed inset-0 z-50 bg-ink-950"
      : "panel h-44 w-64 rounded-2xl shadow-2xl";

  return (
    <div
      onMouseEnter={ponteiroFino ? () => setHovering(true) : undefined}
      onMouseLeave={ponteiroFino ? () => setHovering(false) : undefined}
      className={`flex flex-col overflow-hidden ${caixa}`}
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`size-full ${mapaInterativo ? "" : "pointer-events-none"}`}
          style={{ touchAction: mapaInterativo ? "none" : "auto" }}
        />

        {ponteiroFino ? (
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
        ) : null}

        {/* Toque, mapa aberto: fechar e zoom com alvos de 48px. */}
        {!ponteiroFino && aberto ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            <div className="flex justify-end">
              <TouchChip label="Fechar o mapa" onClick={() => setAberto(false)} largo>
                Fechar
              </TouchChip>
            </div>

            <div className="flex flex-col items-end gap-2">
              <TouchChip label="Aproximar o mapa" onClick={() => ajustarZoom(1)}>
                +
              </TouchChip>
              <TouchChip label="Afastar o mapa" onClick={() => ajustarZoom(-1)}>
                −
              </TouchChip>
            </div>
          </div>
        ) : null}

        {/* Toque, mapa fechado: a prévia inteira é o botão de abrir. */}
        {!ponteiroFino && !aberto ? (
          <button
            type="button"
            onClick={() => setAberto(true)}
            aria-label="Abrir o mapa para palpitar"
            className="absolute inset-0 flex items-end justify-center bg-ink-950/45 p-3 text-sm font-semibold text-mist-100"
          >
            <span className="rounded-xl border border-ink-600 bg-ink-950/85 px-4 py-2.5">
              {guess ? "Toque para ajustar" : "Toque para palpitar"}
            </span>
          </button>
        ) : null}
      </div>

      <div
        className={`shrink-0 p-2 ${
          !ponteiroFino && aberto
            ? "panel pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            : ""
        }`}
      >
        <button
          type="button"
          disabled={!guess || disabled}
          onClick={confirm}
          className="min-h-11 w-full rounded-xl bg-beam-500 px-4 py-2.5 font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-300"
        >
          {disabled ? (
            "Palpite enviado"
          ) : guess ? (
            <span className="flex items-center justify-center gap-2">
              Confirmar palpite
              {ponteiroFino && (
                <kbd className="rounded border border-ink-950/25 px-1.5 py-0.5 text-[11px] font-medium">
                  espaço
                </kbd>
              )}
            </span>
          ) : ponteiroFino ? (
            "Clique no mapa para palpitar"
          ) : (
            "Toque no mapa para palpitar"
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

/** Mesmo chip, em tamanho de dedo (48px) e clicável sobre a camada de overlay. */
function TouchChip({
  label,
  onClick,
  largo = false,
  children,
}: {
  label: string;
  onClick: () => void;
  largo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto flex h-12 items-center justify-center rounded-xl border border-ink-600 bg-ink-950/85 text-sm font-semibold text-mist-100 backdrop-blur ${
        largo ? "min-w-12 px-5" : "w-12"
      }`}
    >
      {children}
    </button>
  );
}
