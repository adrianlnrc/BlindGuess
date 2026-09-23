"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Avatar from "@/components/Avatar";
import type { Avatar as AvatarType } from "@/lib/types";
import { temWebGL } from "./webgl";

/**
 * Entrada pública do personagem 3D.
 *
 * O Three.js entra por `next/dynamic` com `ssr: false`: nenhuma rota que não
 * mostre o personagem carrega o pacote, e a tela de jogo continua leve. Sem
 * WebGL — navegador antigo, GPU bloqueada, contexto recusado — ou se a cena
 * estourar na criação, cai no bonequinho SVG em vez de tela preta.
 */
const Cena = dynamic(() => import("./PersonagemCanvas"), { ssr: false });

export type Personagem3DProps = {
  avatar: AvatarType;
  className?: string;
  /** Tamanho do bonequinho SVG usado como reserva. */
  tamanhoReserva?: number;
  rotationY?: number;
  animar?: boolean;
};

export default function Personagem3D({
  avatar,
  className,
  tamanhoReserva = 160,
  rotationY,
  animar,
}: Personagem3DProps) {
  // `null` = ainda não sabemos (servidor e primeiro quadro no cliente).
  const [suporta, setSuporta] = useState<boolean | null>(null);

  useEffect(() => {
    setSuporta(temWebGL());
  }, []);

  const reserva = <Reserva avatar={avatar} className={className} tamanho={tamanhoReserva} />;

  if (suporta !== true) return reserva;

  return (
    <LimiteDeErro reserva={reserva}>
      <Cena avatar={avatar} className={className} rotationY={rotationY} animar={animar} />
    </LimiteDeErro>
  );
}

/** Bonequinho SVG centralizado, do mesmo jeito que o canvas ocuparia. */
function Reserva({
  avatar,
  className,
  tamanho,
}: {
  avatar: AvatarType;
  className?: string;
  tamanho: number;
}) {
  return (
    <div
      className={className}
      style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}
      data-personagem="svg"
    >
      <Avatar avatar={avatar} size={tamanho} />
    </div>
  );
}

/** Se a cena quebrar em tempo de execução, mostra o SVG e segue o jogo. */
class LimiteDeErro extends Component<{ reserva: ReactNode; children: ReactNode }, { caiu: boolean }> {
  state = { caiu: false };

  static getDerivedStateFromError() {
    return { caiu: true };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[personagem-3d] caiu para o SVG:", erro);
  }

  render() {
    return this.state.caiu ? this.props.reserva : this.props.children;
  }
}
