"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Avatar from "@/components/Avatar";
import { temWebGL } from "@/components/three";
import type { Avatar as AvatarType } from "@/lib/types";
import type { Enquadramento } from "./enquadramento";

/**
 * Entrada do personagem do provador, com as mesmas garantias do `Personagem3D`
 * da fachada: o Three.js entra por `next/dynamic` com `ssr: false`, e sem
 * WebGL — ou se a cena estourar — cai no bonequinho SVG. Customizar e comprar
 * nunca dependem de GPU.
 *
 * O que ele acrescenta é o `enquadramento`, que o `Personagem3D` não expõe.
 */
const Cena = dynamic(() => import("./PersonagemCena"), { ssr: false });

export type PersonagemPalcoProps = {
  avatar: AvatarType;
  className?: string;
  tamanhoReserva?: number;
  rotationY?: number;
  animar?: boolean;
  enquadramento?: Enquadramento;
};

export default function PersonagemPalco({
  avatar,
  className,
  tamanhoReserva = 160,
  rotationY,
  animar,
  enquadramento,
}: PersonagemPalcoProps) {
  // `null` = ainda não sabemos (servidor e primeiro quadro no cliente).
  const [suporta, setSuporta] = useState<boolean | null>(null);

  useEffect(() => {
    setSuporta(temWebGL());
  }, []);

  const reserva = (
    <div
      className={className}
      style={{ display: "grid", placeItems: "center", width: "100%", height: "100%" }}
      data-personagem="svg"
    >
      <Avatar avatar={avatar} size={tamanhoReserva} />
    </div>
  );

  if (suporta !== true) return reserva;

  return (
    <LimiteDeErro reserva={reserva}>
      <Cena
        avatar={avatar}
        className={className}
        rotationY={rotationY}
        animar={animar}
        enquadramento={enquadramento}
      />
    </LimiteDeErro>
  );
}

/** Se a cena quebrar em tempo de execução, mostra o SVG e segue o jogo. */
class LimiteDeErro extends Component<{ reserva: ReactNode; children: ReactNode }, { caiu: boolean }> {
  state = { caiu: false };

  static getDerivedStateFromError() {
    return { caiu: true };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[provador] caiu para o SVG:", erro);
  }

  render() {
    return this.state.caiu ? this.props.reserva : this.props.children;
  }
}
