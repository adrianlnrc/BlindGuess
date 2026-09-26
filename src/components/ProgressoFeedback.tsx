"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefereMenosMovimento } from "@/components/three/preferencias";
import { levelForXp } from "@/lib/level";

/**
 * Feedback de progresso da tela inicial: o que foi ganho desde a última vez que
 * o jogador olhou a home.
 *
 * Nada de regra nova — a curva de XP (`src/lib/level.ts`) e as moedas
 * (`src/lib/shop.ts`) continuam intocadas. Aqui só guardamos o último valor
 * visto, para saber de quanto foi o pulo quando alguém volta de uma partida, e
 * animamos do valor antigo até o atual.
 */

/**
 * A chave leva o id do perfil. Global, ela misturaria contas na mesma maquina:
 * entrar com a conta (50.000 de XP), sair, jogar de convidado (2.000) e voltar
 * a conta faria a tela comemorar "+48.000 XP" e uma subida de nivel que nunca
 * aconteceu. Convidado e conta convivem de proposito neste jogo, entao isto e
 * alcancavel por uma pessoa so.
 */
const CHAVE_BASE = "blindguess:progresso-visto";

function chaveDoPerfil(perfilId: string): string {
  return `${CHAVE_BASE}:${perfilId}`;
}
/** Quanto tempo os avisos de ganho ficam na tela. */
const DURACAO_AVISO = 4200;

export type Ganho = {
  /** Muda a cada ganho novo: serve de chave para remontar as animações. */
  id: number;
  xp: number;
  moedas: number;
  xpAntes: number;
  moedasAntes: number;
  nivelAntes: number;
  nivelDepois: number;
  subiuDeNivel: boolean;
};

type Visto = { xp: number; moedas: number };

function leVisto(perfilId: string): Visto | null {
  try {
    const raw = window.localStorage.getItem(chaveDoPerfil(perfilId));
    if (!raw) return null;
    const dados = JSON.parse(raw) as Partial<Visto>;
    if (typeof dados.xp !== "number" || typeof dados.moedas !== "number") return null;
    return { xp: dados.xp, moedas: dados.moedas };
  } catch {
    return null;
  }
}

function salvaVisto(perfilId: string, valor: Visto): void {
  try {
    window.localStorage.setItem(chaveDoPerfil(perfilId), JSON.stringify(valor));
  } catch {
    // modo anônimo: sem memória entre visitas, o ganho só não aparece
  }
}

/**
 * Compara o XP e as moedas atuais com o último valor visto nesta máquina.
 *
 * Devolve o ganho por alguns segundos e depois some. Na primeira visita não há
 * com o que comparar, então não inventa ganho nenhum. O valor visto é gravado
 * na hora, então recarregar a página não repete a comemoração.
 */
export function useGanhoDeProgresso(
  perfilId: string | undefined,
  xp: number | null,
  moedas: number | null,
): Ganho | null {
  const [ganho, setGanho] = useState<Ganho | null>(null);
  const contador = useRef(0);

  useEffect(() => {
    if (!perfilId || xp === null || moedas === null) return;

    const visto = leVisto(perfilId);
    salvaVisto(perfilId, { xp, moedas });
    if (!visto) return;

    const dXp = xp - visto.xp;
    const dMoedas = moedas - visto.moedas;
    if (dXp <= 0 && dMoedas <= 0) return;

    contador.current += 1;
    const nivelAntes = levelForXp(visto.xp);
    const nivelDepois = levelForXp(xp);
    setGanho({
      id: contador.current,
      xp: Math.max(0, dXp),
      moedas: Math.max(0, dMoedas),
      xpAntes: visto.xp,
      moedasAntes: visto.moedas,
      nivelAntes,
      nivelDepois,
      subiuDeNivel: nivelDepois > nivelAntes,
    });
  }, [perfilId, xp, moedas]);

  useEffect(() => {
    if (!ganho) return;
    const timer = window.setTimeout(() => setGanho(null), DURACAO_AVISO);
    return () => window.clearTimeout(timer);
  }, [ganho]);

  return ganho;
}

/**
 * Número que sobe de `de` até `destino`.
 *
 * Com `prefers-reduced-motion`, ou sem valor de partida, devolve o destino de
 * cara: quem pediu menos movimento vê o número final direto.
 */
export function useContagem(destino: number, de: number | null, duracao = 1100): number {
  const reduzMovimento = usePrefereMenosMovimento();
  const [valor, setValor] = useState(destino);

  useEffect(() => {
    if (de === null || de === destino || reduzMovimento) {
      setValor(destino);
      return;
    }

    let quadro = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const suave = 1 - (1 - t) ** 3;
      setValor(Math.round(de + (destino - de) * suave));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };

    setValor(de);
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [destino, de, duracao, reduzMovimento]);

  return valor;
}

/** Selo de ganho: "+1.250 XP", "+80 moedas". */
export function ChipGanho({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom: "xp" | "moeda" | "nivel";
}) {
  const reduzMovimento = usePrefereMenosMovimento();
  const [entrou, setEntrou] = useState(false);

  // Entrada por transição, não por keyframe: o primeiro quadro pinta o selo
  // apagado e o efeito, logo depois da pintura, liga o estado final. Com menos
  // movimento o selo já nasce pronto e nada se move.
  useEffect(() => {
    setEntrou(true);
  }, []);

  const cores =
    tom === "moeda"
      ? "border-flare-400/50 bg-flare-400/15 text-flare-400"
      : tom === "nivel"
        ? "border-beam-400/60 bg-beam-400/20 text-beam-400"
        : "border-beam-500/50 bg-beam-500/15 text-beam-400";

  const movimento = reduzMovimento
    ? ""
    : `transition duration-300 ease-out ${entrou ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold num ${cores} ${movimento}`}
    >
      {tom === "nivel" ? rotulo : `+${valor.toLocaleString("pt-BR")} ${rotulo}`}
    </span>
  );
}

/**
 * Os avisos de ganho juntos, para pousar sobre a cena da home.
 *
 * É decoração de leitura rápida: não recebe clique, então nunca fica na frente
 * de um botão.
 */
export function AvisosDeGanho({ ganho, className }: { ganho: Ganho | null; className?: string }) {
  if (!ganho) return null;

  return (
    <div
      className={`pointer-events-none flex flex-col items-end gap-2 ${className ?? ""}`}
      aria-live="polite"
    >
      {ganho.subiuDeNivel && (
        <ChipGanho valor={ganho.nivelDepois} rotulo={`Nível ${ganho.nivelDepois}!`} tom="nivel" />
      )}
      {ganho.xp > 0 && <ChipGanho valor={ganho.xp} rotulo="XP" tom="xp" />}
      {ganho.moedas > 0 && <ChipGanho valor={ganho.moedas} rotulo="🪙" tom="moeda" />}
    </div>
  );
}
