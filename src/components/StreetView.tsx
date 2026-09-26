"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadMaps } from "@/lib/maps";
import type { RoomSettings } from "@/lib/types";

type Props = {
  panoId: string;
  settings: Pick<RoomSettings, "allowMove" | "allowPan" | "allowZoom">;
};

/** Giro e inclinação por segundo com a tecla presa — o ritmo que o GeoGuessr tem. */
const GIRO_POR_SEGUNDO = 110;
const INCLINACAO_POR_SEGUNDO = 70;
/** Inclinar além disso embrulha a imagem; a própria API também trava por aqui. */
const INCLINACAO_MAXIMA = 85;
/** Cadência de W/S e +/− com a tecla presa: a repetição do teclado varia por máquina. */
const CADENCIA_PASSO = 380;
const CADENCIA_ZOOM = 240;
/** Só anda por um link que aponte mais ou menos para onde o jogador olha. */
const TOLERANCIA_DO_LINK = 50;

/**
 * Tela que mostra a lista de atalhos: ponteiro de verdade (sinal de que existe
 * teclado junto) e largura de desktop. Numa tela estreita o mini-mapa ocupa o
 * caminho por onde a lista cresceria, e teclado ali é exceção.
 */
const TELA_DE_ATALHOS = "(hover: hover) and (pointer: fine) and (min-width: 640px)";
/** A dica automática aparece uma vez por aba, não a cada rodada. */
const CHAVE_DICA = "blindguess:atalhos-vistos";

/**
 * Traduz a tecla física no atalho do jogo. Vai pelo `code` para não depender do
 * layout (no ABNT2 o `+` também sai do `Equal` com shift) e o `keyup` encontrar
 * exatamente o mesmo nome que o `keydown` guardou.
 */
function atalhoDe(event: KeyboardEvent): string | null {
  switch (event.code) {
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
    case "KeyW":
    case "KeyS":
    case "KeyR":
      return event.code;
    case "Equal":
    case "NumpadAdd":
      return "Mais";
    case "Minus":
    case "NumpadSubtract":
      return "Menos";
    default:
      if (event.key === "+") return "Mais";
      if (event.key === "-") return "Menos";
      return null;
  }
}

/** O chat e os campos da sala têm prioridade: digitar nunca vira comando. */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

const normaliza = (graus: number) => ((graus % 360) + 360) % 360;

/** Menor diferença entre dois ângulos, de 0 a 180. */
function distanciaAngular(a: number, b: number): number {
  const d = Math.abs(normaliza(a) - normaliza(b));
  return d > 180 ? 360 - d : d;
}

/** Panorama do Street View, com os controles que o jogador espera ter. */
export default function StreetView({ panoId, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  /** Onde a rodada começou, para o botão de voltar ao início. */
  const startRef = useRef<{ pano: string; heading: number; pitch: number } | null>(null);
  /** Quais atalhos estão presos agora: é daqui que sai o giro contínuo. */
  const teclasRef = useRef<Set<string>>(new Set());

  const [heading, setHeading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [atalhosAbertos, setAtalhosAbertos] = useState(false);

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

  /** Gira e inclina a câmera em cima do ângulo atual do panorama. */
  const gira = useCallback((dHeading: number, dPitch: number) => {
    const panorama = panoramaRef.current;
    if (!panorama) return;
    const pov = panorama.getPov();
    const pitch = Math.max(
      -INCLINACAO_MAXIMA,
      Math.min(INCLINACAO_MAXIMA, (pov.pitch ?? 0) + dPitch),
    );
    panorama.setPov({ heading: normaliza((pov.heading ?? 0) + dHeading), pitch });
  }, []);

  /**
   * Anda um passo para frente (1) ou para trás (−1) pelos links do panorama.
   * Sem link apontando para aquele lado o jogador fica onde está — é a mesma
   * regra das setas que a API desenha no chão.
   */
  const anda = useCallback((sentido: 1 | -1) => {
    const panorama = panoramaRef.current;
    if (!panorama) return;

    const links = panorama.getLinks?.() ?? [];
    const desejado = normaliza((panorama.getPov().heading ?? 0) + (sentido === 1 ? 0 : 180));

    let escolhido: google.maps.StreetViewLink | null = null;
    let menorDistancia = TOLERANCIA_DO_LINK;
    for (const link of links) {
      if (!link?.pano || typeof link.heading !== "number") continue;
      const distancia = distanciaAngular(link.heading, desejado);
      if (distancia <= menorDistancia) {
        menorDistancia = distancia;
        escolhido = link;
      }
    }
    if (!escolhido?.pano) return;

    // O olhar continua para o mesmo lado depois do passo: quem anda não gira.
    const pov = panorama.getPov();
    panorama.setPano(escolhido.pano);
    panorama.setPov({ heading: pov.heading ?? 0, pitch: pov.pitch ?? 0 });
  }, []);

  // Teclado do panorama: quem joga no desktop não gira com o mouse.
  useEffect(() => {
    const teclas = teclasRef.current;
    let quadro = 0;
    let anterior = 0;
    let proximoPasso = 0;
    let proximoZoom = 0;

    const pulso = (agora: number) => {
      const dt = anterior ? Math.min((agora - anterior) / 1000, 0.1) : 0;
      anterior = agora;

      if (settings.allowPan) {
        const giro = (teclas.has("ArrowRight") ? 1 : 0) - (teclas.has("ArrowLeft") ? 1 : 0);
        const inclina = (teclas.has("ArrowUp") ? 1 : 0) - (teclas.has("ArrowDown") ? 1 : 0);
        if (giro || inclina) {
          gira(giro * GIRO_POR_SEGUNDO * dt, inclina * INCLINACAO_POR_SEGUNDO * dt);
        }
      }

      const sentido = (teclas.has("KeyW") ? 1 : 0) - (teclas.has("KeyS") ? 1 : 0);
      if (settings.allowMove && sentido && agora >= proximoPasso) {
        anda(sentido as 1 | -1);
        proximoPasso = agora + CADENCIA_PASSO;
      }

      const zoom = (teclas.has("Mais") ? 1 : 0) - (teclas.has("Menos") ? 1 : 0);
      if (settings.allowZoom && zoom && agora >= proximoZoom) {
        nudgeZoom(zoom);
        proximoZoom = agora + CADENCIA_ZOOM;
      }

      // O laço só existe enquanto alguma tecla está presa.
      if (teclas.size > 0) {
        quadro = requestAnimationFrame(pulso);
      } else {
        quadro = 0;
        anterior = 0;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (digitando(event.target)) return;
      const atalho = atalhoDe(event);
      if (!atalho) return;

      if (atalho === "KeyR") {
        if (event.repeat) return;
        event.preventDefault();
        returnToStart();
        return;
      }

      const permitido =
        atalho.startsWith("Arrow")
          ? settings.allowPan
          : atalho === "KeyW" || atalho === "KeyS"
            ? settings.allowMove
            : settings.allowZoom;
      if (!permitido) return;

      event.preventDefault();
      if (event.repeat) return;

      // O primeiro toque age na hora; o laço cuida da repetição com a tecla presa.
      if (atalho === "KeyW") {
        anda(1);
        proximoPasso = performance.now() + CADENCIA_PASSO;
      } else if (atalho === "KeyS") {
        anda(-1);
        proximoPasso = performance.now() + CADENCIA_PASSO;
      } else if (atalho === "Mais" || atalho === "Menos") {
        nudgeZoom(atalho === "Mais" ? 1 : -1);
        proximoZoom = performance.now() + CADENCIA_ZOOM;
      }

      teclas.add(atalho);
      if (!quadro) quadro = requestAnimationFrame(pulso);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const atalho = atalhoDe(event);
      if (atalho) teclas.delete(atalho);
    };

    /** Trocar de janela com a tecla presa deixaria a câmera girando sozinha. */
    const solta = () => teclas.clear();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", solta);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", solta);
      if (quadro) cancelAnimationFrame(quadro);
      teclas.clear();
    };
  }, [settings.allowPan, settings.allowMove, settings.allowZoom, gira, anda, nudgeZoom, returnToStart]);

  // Atalho que ninguém descobre não existe: na primeira rodada da aba a lista
  // abre sozinha e fecha em seguida, só em quem tem teclado para usá-la.
  useEffect(() => {
    if (!window.matchMedia(TELA_DE_ATALHOS).matches) return;
    try {
      if (sessionStorage.getItem(CHAVE_DICA)) return;
      sessionStorage.setItem(CHAVE_DICA, "1");
    } catch {
      // Navegador sem sessionStorage: mostra a dica e segue o jogo.
    }

    setAtalhosAbertos(true);
    const relogio = setTimeout(() => setAtalhosAbertos(false), 7000);
    return () => clearTimeout(relogio);
  }, []);

  return (
    <div className="relative size-full bg-ink-900">
      <div ref={containerRef} className="size-full" />

      {/* Sem pan: uma camada transparente engole o arrasto do mouse. */}
      {!settings.allowPan && <div className="absolute inset-0 cursor-not-allowed" />}

      {/*
        Canto de baixo à esquerda: bússola, controles e a lista de atalhos. No
        desktop a coluna sobe 80px porque a bolha do chat da sala ancora em
        `bottom-3 left-3` — os 56px dela ficam livres embaixo. No celular o chat
        é uma faixa no alto, então aqui o canto é todo nosso.
      */}
      <div className="absolute bottom-4 left-4 flex flex-col items-center gap-3 sm:bottom-20">
        <Compass heading={heading} onClick={lookNorth} />

        <div className="relative flex flex-col overflow-visible">
          {atalhosAbertos && <ListaDeAtalhos settings={settings} />}

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

            <div className="hidden sm:block">
              <span className="block h-px bg-ink-700" />
              <ControlButton
                label="Atalhos do teclado"
                pressed={atalhosAbertos}
                onClick={() => setAtalhosAbertos((aberto) => !aberto)}
              >
                <span className="text-base font-semibold">?</span>
              </ControlButton>
            </div>
          </div>
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

/**
 * Lista de atalhos. Fica absoluta e abre ao lado da coluna, nunca por cima
 * dela: crescendo para cima taparia a bússola, e em linha empurraria os botões
 * de lugar. Some abaixo do `sm` junto com o botão que a abre — lá ela cruzaria
 * o mini-mapa do palpite.
 */
function ListaDeAtalhos({ settings }: { settings: Props["settings"] }) {
  const linhas: Array<[string, string]> = [];
  if (settings.allowPan) {
    linhas.push(["← →", "girar"], ["↑ ↓", "inclinar"]);
  }
  if (settings.allowMove) linhas.push(["W S", "andar"]);
  if (settings.allowZoom) linhas.push(["+ −", "zoom"]);
  linhas.push(["R", "ponto inicial"], ["Espaço", "confirmar palpite"]);

  return (
    <div
      role="note"
      aria-label="Atalhos do teclado"
      className="absolute bottom-0 left-full hidden w-44 rounded-xl border border-ink-600 bg-ink-950/90 ml-3 px-3 py-2.5 backdrop-blur sm:block"
    >
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">Atalhos</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        {linhas.map(([tecla, oQueFaz]) => (
          <div key={tecla} className="col-span-2 flex items-baseline justify-between gap-2">
            <dt className="num rounded border border-ink-600 px-1.5 text-mist-100">{tecla}</dt>
            <dd className="text-mist-300">{oQueFaz}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`grid size-10 place-content-center transition hover:bg-ink-800 hover:text-beam-400 ${
        pressed ? "text-beam-400" : "text-mist-300"
      }`}
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
