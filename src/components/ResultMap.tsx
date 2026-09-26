"use client";

import { useEffect, useRef, useState } from "react";
import { DARK_MAP_STYLE, loadMaps } from "@/lib/maps";
import type { Guess, LatLng } from "@/lib/types";

const PLAYER_COLORS = [
  "#35d6a4", "#ffb454", "#f4628a", "#6aa8ff", "#c084fc", "#facc15",
  "#38bdf8", "#fb923c", "#4ade80", "#f472b6", "#a3e635", "#22d3ee",
];

/** Uma rodada desenhada no mapa: o alvo e os palpites que foram até ele. */
export type MapRound = { round: number; target: LatLng; guesses: Guess[] };

type Props = {
  /** Modo de uma rodada (tela de resultado da rodada). */
  target?: LatLng;
  guesses?: Guess[];
  /**
   * Modo resumo: várias rodadas de uma vez. Tem prioridade sobre `target`.
   * Os alvos aparecem numerados para casar com a tabela do percurso.
   */
  rounds?: MapRound[];
  /**
   * Cor de cada jogador. No resumo a cor tem de ser a mesma em todas as
   * rodadas, então ela vem de fora (índice do jogador na sala); sem isso a cor
   * cairia no índice do palpite, que muda de rodada para rodada.
   */
  colorOf?: (playerId: string, indexNaRodada: number) => string;
};

/** Mapa com o local real e uma linha até o palpite de cada jogador. */
export default function ResultMap({ target, guesses, rounds, colorOf }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<{ setMap: (map: google.maps.Map | null) => void }[]>([]);
  const [pronto, setPronto] = useState(false);
  // Sem chave do Maps (ou sem rede) o mapa não carrega: avisa em vez de sumir.
  const [erro, setErro] = useState<string | null>(null);

  // Normaliza os dois modos numa lista de camadas.
  const camadas: MapRound[] =
    rounds ?? (target ? [{ round: 1, target, guesses: guesses ?? [] }] : []);
  const numerado = !!rounds;

  // Assinatura estável das camadas: evita redesenhar a cada render do pai.
  const chave = JSON.stringify(
    camadas.map((c) => [c.round, c.target, c.guesses.map((g) => [g.playerId, g.position])]),
  );

  useEffect(() => {
    let cancelled = false;

    loadMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: 15, lng: 0 },
          zoom: 2,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: DARK_MAP_STYLE,
          minZoom: 1,
        });
        setPronto(true);
      })
      .catch((err: Error) => !cancelled && setErro(err.message));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pronto) return;

    const maps = google.maps;

    // Limpa o desenho anterior — o filtro troca as camadas sem recriar o mapa.
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    overlaysRef.current = [];

    // Quanto mais linha na tela, mais fina ela tem de ser para não virar borrão.
    const linhas = camadas.reduce((soma, c) => soma + c.guesses.length, 0);
    const peso = linhas > 24 ? 1.1 : linhas > 10 ? 1.5 : 2;
    const opacidade = linhas > 24 ? 0.5 : linhas > 10 ? 0.62 : 0.75;

    const bounds = new maps.LatLngBounds();

    for (const camada of camadas) {
      bounds.extend(camada.target);

      const alvo = numerado
        ? new maps.Marker({
            position: camada.target,
            map,
            title: `Rodada ${camada.round} — local real`,
            label: {
              text: String(camada.round),
              color: "#110b20",
              fontSize: "11px",
              fontWeight: "700",
            },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 11,
              fillColor: "#ffffff",
              fillOpacity: 1,
              strokeColor: "#110b20",
              strokeWeight: 2,
              labelOrigin: new maps.Point(0, 0),
            },
            zIndex: 999,
          })
        : new maps.Marker({
            position: camada.target,
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

      overlaysRef.current.push(alvo);

      camada.guesses.forEach((guess, index) => {
        const color = colorOf
          ? colorOf(guess.playerId, index)
          : PLAYER_COLORS[index % PLAYER_COLORS.length];

        overlaysRef.current.push(
          new maps.Marker({
            position: guess.position,
            map,
            title: numerado
              ? `${guess.playerName} — rodada ${camada.round}`
              : guess.playerName,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: numerado ? 5.5 : 7,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: "#080c14",
              strokeWeight: 2,
            },
          }),
          new maps.Polyline({
            map,
            path: [guess.position, camada.target],
            strokeColor: color,
            strokeOpacity: opacidade,
            strokeWeight: peso,
            // Arco de círculo máximo: duas linhas longas deixam de se sobrepor.
            geodesic: numerado,
          }),
        );

        bounds.extend(guess.position);
      });
    }

    // Sem nenhum palpite, `fitBounds` num ponto só estoura o zoom: centraliza.
    const temPalpite = camadas.some((c) => c.guesses.length > 0);
    if (temPalpite) {
      map.fitBounds(bounds, 64);
    } else if (camadas.length > 0) {
      map.setCenter(camadas[0].target);
      map.setZoom(3);
    }
    // `chave` resume as camadas; `camadas` em si muda de identidade a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, pronto, numerado, colorOf]);

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />

      {erro && (
        <div className="pointer-events-none absolute inset-0 grid place-content-center gap-1 p-4 text-center">
          <p className="text-sm font-semibold text-rose-signal">Não deu para carregar o mapa</p>
          <p className="text-xs text-mist-300">{erro}</p>
        </div>
      )}
    </div>
  );
}

export { PLAYER_COLORS };
