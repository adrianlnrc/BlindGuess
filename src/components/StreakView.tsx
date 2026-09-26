"use client";

import Link from "next/link";
import GuessMap from "./GuessMap";
import ResultMap from "./ResultMap";
import StreetView from "./StreetView";
import type { LatLng, RoomState, StreakState } from "@/lib/types";

type Props = {
  state: RoomState;
  playerId: string | undefined;
  onGuess: (position: LatLng) => void;
  onStart: () => void;
  onNext: () => void;
  onPlayAgain: () => void;
};

/**
 * Tela inteira do modo sequência de países — entrada, rodada, resultado e fim de
 * jogo.
 *
 * É tela própria, e não `GameView`/`RoundResult`/`FinalScores`, porque aqui não
 * existe nenhum dos números que aqueles arquivos desenham: sem pontuação, sem
 * distância, sem placar, sem rodada de N. O que há é um número só — a sequência
 * — e ele ocupa o lugar que o placar ocupa nos outros modos.
 */
export default function StreakView({ state, playerId, onGuess, onStart, onNext, onPlayAgain }: Props) {
  // A sala é de sequência: o servidor sempre manda este estado. O `??` só existe
  // para o primeiro quadro, antes do estado chegar.
  const streak = state.streak ?? VAZIA;

  if (state.phase === "lobby") return <Entrada streak={streak} erro={state.error} onStart={onStart} />;
  if (state.phase === "playing") return <Rodada state={state} playerId={playerId} streak={streak} onGuess={onGuess} />;
  return <Veredicto state={state} streak={streak} onNext={onNext} onPlayAgain={onPlayAgain} />;
}

const VAZIA: StreakState = {
  current: 0,
  best: 0,
  countryName: null,
  countryCode: null,
  guessCountryName: null,
  guessCountryCode: null,
  correct: null,
  over: false,
};

// ------------------------------------------------------------------- entrada

function Entrada({
  streak,
  erro,
  onStart,
}: {
  streak: StreakState;
  erro?: string;
  onStart: () => void;
}) {
  // Sequência de pé com a sala na entrada significa que uma rodada foi abortada
  // por falha nossa: o botão precisa dizer que nada foi perdido.
  const retomando = streak.current > 0;

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-content-center gap-6 px-6 py-12 text-center">
      <div>
        <p className="text-xs tracking-widest text-mist-300 uppercase">Modo</p>
        <h1 className="text-4xl font-black">Sequência de países</h1>
      </div>

      <p className="text-mist-300">
        Você cai num lugar qualquer do planeta e aponta no mapa. Acertou o país, vem outro lugar.
        Errou, acabou — não há pontuação, só a sequência.
      </p>

      <div className="panel flex items-center justify-center gap-8 rounded-2xl px-6 py-5">
        <Numero rotulo={retomando ? "Sequência em curso" : "Sequência"} valor={streak.current} destaque />
        <Numero rotulo="Recorde" valor={streak.best} />
      </div>

      {erro && <Aviso texto={erro} />}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onStart}
          className="rounded-xl bg-beam-500 px-6 py-4 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
        >
          {retomando ? `Continuar de ${streak.current}` : "Começar a sequência"}
        </button>
        <Link href="/" className="text-sm text-mist-300 hover:text-mist-100 hover:underline">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}

// -------------------------------------------------------------------- rodada

function Rodada({
  state,
  playerId,
  streak,
  onGuess,
}: {
  state: RoomState;
  playerId: string | undefined;
  streak: StreakState;
  onGuess: (position: LatLng) => void;
}) {
  // Na sequência o palpite fica pendurado: o servidor registra o clique e só
  // depois descobre o país dele. `submitted` é justamente essa espera.
  const conferindo = !!playerId && state.submitted.includes(playerId);

  if (!state.panorama) {
    const busca = state.locationSearch;
    return (
      <main className="grid min-h-dvh place-content-center gap-3 px-6 text-center">
        <p className="text-2xl font-semibold">Procurando um lugar no mundo…</p>
        <p className="text-mist-300">
          {busca && busca.attempt > 1
            ? `Não deu de primeira — tentativa ${busca.attempt} de ${busca.maxAttempts}.`
            : "Sorteando um panorama válido do Street View."}
        </p>
        <p className="text-sm text-mist-300">
          Sequência atual: <strong className="text-mist-100 num">{streak.current}</strong>
        </p>
        {state.error && <Aviso texto={state.error} className="mx-auto max-w-md" />}
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <StreetView panoId={state.panorama.panoId} settings={state.settings} />

      {/* HUD: onde os outros modos põem rodada, tempo e placar, aqui vai a
          sequência — e nada mais, porque nada mais está em jogo. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="panel rounded-xl px-5 py-2.5">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Sequência</p>
          <p className="num text-3xl text-beam-400">{streak.current}</p>
        </div>

        <div className="panel rounded-xl px-4 py-2.5 text-right">
          <p className="text-xs tracking-widest text-mist-300 uppercase">Recorde</p>
          <p className="num text-xl">{streak.best}</p>
        </div>
      </div>

      {(conferindo || state.error) && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-4">
          {conferindo ? (
            <p className="panel rounded-xl px-4 py-2.5 text-sm">
              Conferindo em que país você clicou…
            </p>
          ) : (
            <Aviso texto={state.error!} className="max-w-md" />
          )}
        </div>
      )}

      <div className="absolute right-4 bottom-4">
        <GuessMap onConfirm={onGuess} disabled={conferindo} />
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ resultado

function Veredicto({
  state,
  streak,
  onNext,
  onPlayAgain,
}: {
  state: RoomState;
  streak: StreakState;
  onNext: () => void;
  onPlayAgain: () => void;
}) {
  const result = state.lastResult;
  const acertou = streak.correct === true;
  const acabou = streak.over || state.phase === "finished";

  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      {/* No celular o mapa cede espaço: o que decide a partida é o texto ao
          lado dele, e com metade da tela para cada um o botão de continuar
          nascia fora da vista. */}
      <div className="h-2/5 w-full lg:h-full lg:flex-1">
        {result && <ResultMap target={result.target} guesses={result.guesses} />}
      </div>

      <aside className="flex h-3/5 w-full flex-col gap-4 overflow-y-auto border-t border-ink-700 bg-ink-900/80 p-6 lg:h-full lg:w-96 lg:border-t-0 lg:border-l">
        <header>
          <p className="text-xs tracking-widest text-mist-300 uppercase">
            {acabou ? "Fim da sequência" : "Acertou"}
          </p>
          <h2 className={`text-3xl font-bold ${acertou ? "text-beam-400" : "text-rose-signal"}`}>
            {acertou ? "Era esse país" : "Não era esse país"}
          </h2>
        </header>

        {/* O número da sequência no mesmo peso que o placar tem nos outros
            modos: é o que o jogador vai lembrar da partida. */}
        <section
          className={`rounded-2xl border p-4 text-center sm:p-5 ${
            acabou ? "border-rose-signal/40 bg-rose-signal/5" : "border-beam-500/40 bg-beam-500/5"
          }`}
        >
          <p className="text-xs tracking-widest text-mist-300 uppercase">
            {acabou ? "Sequência final" : "Sequência"}
          </p>
          <p className={`num text-5xl sm:text-6xl ${acabou ? "text-rose-signal" : "text-beam-400"}`}>
            {streak.current}
          </p>
          <p className="mt-1 text-sm text-mist-300">
            {streak.current === 1 ? "país" : "países"} seguidos · recorde{" "}
            <strong className="text-mist-100 num">{streak.best}</strong>
          </p>
        </section>

        <section className="space-y-2">
          <Pais rotulo="Era" code={streak.countryCode} name={streak.countryName} tom="alvo" />
          <Pais
            rotulo="Você disse"
            code={streak.guessCountryCode}
            name={streak.guessCountryName}
            tom={acertou ? "alvo" : "erro"}
          />
        </section>

        {state.error && <Aviso texto={state.error} />}

        {acabou ? (
          <div className="mt-auto flex flex-col gap-3">
            <button
              type="button"
              onClick={onPlayAgain}
              className="rounded-xl bg-beam-500 px-4 py-3 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
            >
              Tentar outra sequência
            </button>
            <Link
              href="/"
              className="text-center text-sm text-mist-300 hover:text-mist-100 hover:underline"
            >
              Voltar ao início
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="mt-auto rounded-xl bg-beam-500 px-4 py-3 text-lg font-bold text-ink-950 transition hover:bg-beam-400"
          >
            Próximo país
          </button>
        )}
      </aside>
    </main>
  );
}

// -------------------------------------------------------------------- peças

function Pais({
  rotulo,
  code,
  name,
  tom,
}: {
  rotulo: string;
  code: string | null;
  name: string | null;
  tom: "alvo" | "erro";
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        tom === "alvo" ? "border-beam-500/40" : "border-rose-signal/40"
      }`}
    >
      <span className="text-3xl" aria-hidden>
        {bandeira(code) ?? "🌊"}
      </span>
      <div className="min-w-0">
        <p className="text-xs tracking-widest text-mist-300 uppercase">{rotulo}</p>
        <p className="truncate text-lg font-bold">
          {name ?? "nenhum país"}
          {code && <span className="ml-2 text-sm font-medium text-mist-300">{code}</span>}
        </p>
      </div>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-xs tracking-widest text-mist-300 uppercase">{rotulo}</p>
      <p className={`num text-4xl ${destaque ? "text-beam-400" : ""}`}>{valor}</p>
    </div>
  );
}

function Aviso({ texto, className = "" }: { texto: string; className?: string }) {
  return (
    <p
      className={`rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-sm text-flare-400 ${className}`}
    >
      {texto}
    </p>
  );
}

/**
 * Bandeira a partir do ISO-2, montada com os indicadores regionais do Unicode —
 * duas letras viram uma bandeira sem precisar de nenhuma imagem no projeto. O
 * código continua escrito ao lado, porque em Windows ele é o que se lê.
 */
function bandeira(code: string | null): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((letra) => 0x1f1e6 + letra.charCodeAt(0) - 65),
  );
}
