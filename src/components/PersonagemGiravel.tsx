"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Personagem3D } from "@/components/three";
import { useAbaVisivel, usePrefereMenosMovimento } from "@/components/three/preferencias";
import type { Avatar as AvatarType } from "@/lib/types";

type Props = {
  avatar: AvatarType;
  /** Altura do palco em pixels. O componente ocupa toda a largura disponível. */
  altura?: number;
  /** Tamanho do bonequinho SVG quando não há WebGL. */
  tamanhoReserva?: number;
  className?: string;
  /** Conteúdo sobreposto ao palco (etiqueta de preço, aviso de prévia…). */
  children?: React.ReactNode;
  /** Desliga o giro lento de vitrine. */
  girarSozinho?: boolean;
};

/** Quanto o personagem gira por pixel arrastado. */
const RAD_POR_PIXEL = 0.011;
/** Passo dos botões e das setas do teclado. */
const PASSO = Math.PI / 8;
/** Giro de vitrine: 0,35 rad/s em quadros de 100 ms — barato e discreto. */
const INTERVALO_VITRINE = 100;
const PASSO_VITRINE = 0.035;

/**
 * Palco do provador: o personagem grande, girável com o dedo, com o mouse, com
 * os botões ou com as setas do teclado.
 *
 * O 3D vem inteiro de `src/components/three` (carregamento tardio, detecção de
 * WebGL e reserva em SVG já resolvidos lá). Aqui só entra o gesto:
 *
 * - **celular**: a superfície usa `touch-action: pan-y`, então o dedo na
 *   vertical continua rolando a página e só o movimento horizontal gira o
 *   personagem. Os botões têm 44px.
 * - **`prefers-reduced-motion`**: nenhum giro automático; quem pediu menos
 *   movimento gira quando quiser.
 * - o giro de vitrine também para no primeiro toque e quando a aba sai de vista.
 */
export default function PersonagemGiravel({
  avatar,
  altura = 300,
  tamanhoReserva,
  className = "",
  children,
  girarSozinho = true,
}: Props) {
  const [giro, setGiro] = useState(0);
  const [tocado, setTocado] = useState(false);
  const arrastando = useRef<{ id: number; x: number } | null>(null);

  const reduzMovimento = usePrefereMenosMovimento();
  const abaVisivel = useAbaVisivel();
  const vitrine = girarSozinho && !reduzMovimento && !tocado && abaVisivel;

  useEffect(() => {
    if (!vitrine) return;
    const timer = window.setInterval(
      () => setGiro((g) => g + PASSO_VITRINE),
      INTERVALO_VITRINE,
    );
    return () => window.clearInterval(timer);
  }, [vitrine]);

  const empurra = useCallback((delta: number) => {
    setTocado(true);
    setGiro((g) => g + delta);
  }, []);

  function aoDescer(e: React.PointerEvent<HTMLDivElement>) {
    arrastando.current = { id: e.pointerId, x: e.clientX };
    setTocado(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const atual = arrastando.current;
    if (!atual || atual.id !== e.pointerId) return;
    const dx = e.clientX - atual.x;
    if (dx === 0) return;
    atual.x = e.clientX;
    setGiro((g) => g + dx * RAD_POR_PIXEL);
  }

  function aoSubir(e: React.PointerEvent<HTMLDivElement>) {
    if (arrastando.current?.id !== e.pointerId) return;
    arrastando.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") empurra(-PASSO);
    else if (e.key === "ArrowRight") empurra(PASSO);
    else return;
    e.preventDefault();
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        data-provador="palco"
        tabIndex={0}
        role="group"
        aria-label="Personagem em 3D — arraste para girar, ou use as setas"
        onPointerDown={aoDescer}
        onPointerMove={aoMover}
        onPointerUp={aoSubir}
        onPointerCancel={aoSubir}
        onKeyDown={aoTeclar}
        style={{ height: altura, touchAction: "pan-y" }}
        className="relative w-full cursor-grab overflow-hidden rounded-2xl border border-ink-700 bg-ink-950/60 select-none active:cursor-grabbing focus-visible:border-beam-500 focus-visible:outline-none"
      >
        <Personagem3D
          avatar={avatar}
          rotationY={giro}
          tamanhoReserva={tamanhoReserva ?? Math.min(220, Math.round(altura * 0.8))}
          className="size-full"
        />
        {children}
      </div>

      <div className="flex items-center gap-2">
        <BotaoGiro rotulo="Girar para a esquerda" onClick={() => empurra(-PASSO)}>
          ↺
        </BotaoGiro>
        <span className="text-xs text-mist-300">arraste o personagem para girar</span>
        <BotaoGiro rotulo="Girar para a direita" onClick={() => empurra(PASSO)}>
          ↻
        </BotaoGiro>
      </div>
    </div>
  );
}

function BotaoGiro({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="grid size-11 shrink-0 place-content-center rounded-xl border border-ink-600 text-lg text-mist-100 transition hover:border-beam-500 hover:text-beam-400"
    >
      {children}
    </button>
  );
}
