"use client";

import { useCallback, useMemo, useState } from "react";
import Avatar from "./Avatar";
import ResultMap, { PLAYER_COLORS, type MapRound } from "./ResultMap";
import { formatDistance, MAX_ROUND_SCORE } from "@/lib/scoring";
import type { Player, RoomState, RoundResult } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
};

/**
 * Acima disto o mapa "todas as rodadas" deixa de ser mapa e vira macarrão, então
 * a tela abre já numa rodada só — o jogador escolhe abrir o resto.
 */
const LIMITE_LINHAS = 20;

type FiltroRodada = number | "todas";
type FiltroJogador = string | "todos";

/**
 * Resumo do percurso da partida: todas as rodadas num mapa e a tabela rodada a
 * rodada. O dado vem inteiro de `state.history`.
 */
export default function MatchSummary({ state, playerId }: Props) {
  // `?? []` protege contra payload antigo de um cliente que ficou aberto.
  const history = useMemo(() => state.history ?? [], [state.history]);
  const players = state.players;

  // Cor por jogador, não por palpite: a mesma pessoa tem de ter a mesma cor em
  // todas as rodadas, senão o mapa não conta história nenhuma.
  const corPorJogador = useMemo(() => {
    const mapa = new Map<string, string>();
    players.forEach((p, i) => mapa.set(p.id, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    return mapa;
  }, [players]);

  const totalLinhas = history.reduce((soma, r) => soma + r.guesses.length, 0);
  const muitasLinhas = totalLinhas > LIMITE_LINHAS;

  const [rodada, setRodada] = useState<FiltroRodada>(() =>
    muitasLinhas && history.length > 0 ? history[0].round : "todas",
  );
  const [jogador, setJogador] = useState<FiltroJogador>("todos");

  const visiveis = useMemo(
    () => history.filter((r) => rodada === "todas" || r.round === rodada),
    [history, rodada],
  );

  const camadas = useMemo<MapRound[]>(
    () =>
      visiveis.map((r) => ({
        round: r.round,
        target: r.target,
        guesses: jogador === "todos" ? r.guesses : r.guesses.filter((g) => g.playerId === jogador),
      })),
    [visiveis, jogador],
  );

  const colorOf = useCallback(
    (id: string, index: number) => corPorJogador.get(id) ?? PLAYER_COLORS[index % PLAYER_COLORS.length],
    [corPorJogador],
  );

  if (history.length === 0) return null;

  const linhasNoMapa = camadas.reduce((soma, c) => soma + c.guesses.length, 0);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">O percurso da partida</h2>
          <p className="text-sm text-mist-300">
            {history.length} {history.length === 1 ? "rodada" : "rodadas"} · onde caiu, onde cada um
            chutou e quanto errou.
          </p>
        </div>
        <p className="text-xs text-mist-300">
          {linhasNoMapa} {linhasNoMapa === 1 ? "palpite" : "palpites"} no mapa
        </p>
      </header>

      {/* ------------------------------------------------------------ filtros */}
      <div className="panel space-y-3 rounded-2xl p-4">
        <Filtro rotulo="Rodada">
          <Chip ativo={rodada === "todas"} onClick={() => setRodada("todas")}>
            Todas
          </Chip>
          {history.map((r) => (
            <Chip
              key={r.round}
              ativo={rodada === r.round}
              onClick={() => setRodada(r.round)}
              titulo={`Ver só a rodada ${r.round}`}
            >
              {r.round}
            </Chip>
          ))}
        </Filtro>

        <Filtro rotulo="Jogador">
          <Chip ativo={jogador === "todos"} onClick={() => setJogador("todos")}>
            Todos
          </Chip>
          {players.map((p) => (
            <Chip
              key={p.id}
              ativo={jogador === p.id}
              onClick={() => setJogador(p.id)}
              titulo={`Ver só os palpites de ${p.name}`}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: corPorJogador.get(p.id) }}
              />
              <span className="max-w-24 truncate sm:max-w-32">{p.name}</span>
            </Chip>
          ))}
        </Filtro>

        {rodada === "todas" && muitasLinhas && (
          <p className="text-xs text-mist-300">
            São {totalLinhas} linhas de uma vez. Para ler com calma, escolha uma rodada ou um
            jogador acima.
          </p>
        )}
      </div>

      {/* --------------------------------------------------------------- mapa */}
      <div className="panel h-[46vh] min-h-64 overflow-hidden rounded-2xl sm:h-[56vh]">
        <ResultMap rounds={camadas} colorOf={colorOf} />
      </div>

      <p className="text-xs text-mist-300">
        Os círculos brancos numerados são os locais reais — o número é a rodada. Cada linha vai do
        palpite até o local.
      </p>

      {/* ------------------------------------------------ tabela do percurso */}
      <TabelaPercurso
        rodadas={visiveis}
        players={players}
        playerId={playerId}
        corPorJogador={corPorJogador}
        onEscolherRodada={setRodada}
        mostrandoTudo={rodada === "todas"}
      />
    </section>
  );
}

// -------------------------------------------------------------------- filtros

function Filtro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-full text-[11px] tracking-widest text-mist-300 uppercase sm:w-auto">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

function Chip({
  ativo,
  onClick,
  titulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  titulo?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={ativo}
      className={`flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold transition ${
        ativo
          ? "border-beam-500 bg-beam-500/15 text-beam-400"
          : "border-ink-600 text-mist-300 hover:border-beam-500/60 hover:text-mist-100"
      }`}
    >
      {children}
    </button>
  );
}

// --------------------------------------------------------- tabela do percurso

type TabelaProps = {
  rodadas: RoundResult[];
  players: Player[];
  playerId: string | undefined;
  corPorJogador: Map<string, string>;
  onEscolherRodada: (round: number) => void;
  mostrandoTudo: boolean;
};

function TabelaPercurso({
  rodadas,
  players,
  playerId,
  corPorJogador,
  onEscolherRodada,
  mostrandoTudo,
}: TabelaProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs tracking-widest text-mist-300 uppercase">Rodada a rodada</h3>

      {/* Desktop: matriz rodada × jogador, que é onde a comparação acontece. */}
      <div className="panel hidden overflow-hidden rounded-2xl md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-left">
              <th className="px-4 py-3 text-[11px] tracking-widest text-mist-300 uppercase">
                Rodada
              </th>
              {players.map((p) => (
                <th key={p.id} className="px-4 py-3 font-semibold">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: corPorJogador.get(p.id) }}
                    />
                    <Avatar avatar={p.avatar} size={22} className="rounded-md" />
                    <span className="max-w-28 truncate">{p.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rodadas.map((r) => {
              const melhor = Math.max(0, ...r.guesses.map((g) => g.score));
              return (
                <tr key={r.round} className="border-b border-ink-700/60 last:border-0">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onEscolherRodada(r.round)}
                      title={`Ver a rodada ${r.round} sozinha no mapa`}
                      className="flex size-8 items-center justify-center rounded-full bg-mist-100 text-sm font-bold text-ink-950 transition hover:bg-beam-400"
                    >
                      {r.round}
                    </button>
                  </td>
                  {players.map((p) => {
                    const g = r.guesses.find((x) => x.playerId === p.id);
                    return (
                      <td
                        key={p.id}
                        className={`px-4 py-3 ${p.id === playerId ? "bg-beam-500/5" : ""}`}
                      >
                        {g ? (
                          <>
                            <span
                              className={`num ${
                                g.score === melhor && melhor > 0 ? "text-beam-400" : "text-mist-100"
                              }`}
                            >
                              {g.score.toLocaleString("pt-BR")}
                              {g.score === melhor && melhor > 0 && " 👑"}
                            </span>
                            <span className="block text-xs text-mist-300">
                              errou {formatDistance(g.distanceMeters)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-mist-300">sem palpite</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-600 bg-ink-950/40">
              <td className="px-4 py-3 text-[11px] tracking-widest text-mist-300 uppercase">
                Total
              </td>
              {players.map((p) => (
                <td key={p.id} className="px-4 py-3 num text-beam-400">
                  {p.totalScore.toLocaleString("pt-BR")}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Celular: uma matriz de 5 colunas não cabe em 390px, então cada rodada
          vira um cartão com os jogadores em ordem de pontuação. */}
      <ul className="space-y-3 md:hidden">
        {rodadas.map((r) => {
          const ordenados = [...r.guesses].sort((a, b) => b.score - a.score);
          const semPalpite = players.filter((p) => !r.guesses.some((g) => g.playerId === p.id));

          return (
            <li key={r.round} className="panel rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-mist-100 text-xs font-bold text-ink-950">
                  {r.round}
                </span>
                <span className="text-xs tracking-widest text-mist-300 uppercase">
                  Rodada {r.round}
                </span>
                {mostrandoTudo && (
                  <button
                    type="button"
                    onClick={() => onEscolherRodada(r.round)}
                    className="ml-auto min-h-9 rounded-lg border border-ink-600 px-2.5 text-xs font-semibold text-mist-300"
                  >
                    Só esta no mapa
                  </button>
                )}
              </div>

              <ul className="mt-3 space-y-2">
                {ordenados.map((g, i) => (
                  <li key={g.playerId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: corPorJogador.get(g.playerId) }}
                        />
                        <span className="truncate">
                          {g.playerName}
                          {i === 0 && g.score > 0 ? " 👑" : ""}
                        </span>
                      </span>
                      <span className="num shrink-0 text-sm text-beam-400">
                        {g.score.toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-700">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (g.score / MAX_ROUND_SCORE) * 100)}%`,
                            background: corPorJogador.get(g.playerId),
                          }}
                        />
                      </span>
                      <span className="shrink-0 text-xs text-mist-300">
                        {formatDistance(g.distanceMeters)}
                      </span>
                    </div>
                  </li>
                ))}

                {semPalpite.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 text-sm text-mist-300">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-xs">sem palpite</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
