"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Personagem3D, temWebGL } from "@/components/three";
import type { Avatar as AvatarType } from "@/lib/types";

/**
 * Entrada pública da cena da tela inicial: o personagem em pé sobre o mundo.
 *
 * O Three.js entra por `next/dynamic` com `ssr: false` — nenhuma outra rota
 * carrega o pacote, e a home pinta a interface inteira antes de a cena chegar.
 * Enquanto o pedaço 3D vem, o lugar já está ocupado por um globo em SVG do
 * mesmo tamanho, então nada pula quando o canvas monta.
 *
 * Sem WebGL — navegador antigo, GPU bloqueada — ou se a cena estourar, fica o
 * globo em SVG com o bonequinho de `Personagem3D` em cima: a home continua
 * inteira, só sem 3D.
 */
const Cena = dynamic(() => import("./MundoCanvas"), {
  ssr: false,
  loading: () => <Reserva />,
});

export type Mundo3DProps = {
  avatar: AvatarType;
  className?: string;
  animar?: boolean;
  /** Contador de celebrações de nível: mudar o número dispara o pulso. */
  celebra?: number;
};

export default function Mundo3D({ avatar, className, animar, celebra }: Mundo3DProps) {
  // `null` = ainda não sabemos (servidor e primeiro quadro no cliente).
  const [suporta, setSuporta] = useState<boolean | null>(null);

  useEffect(() => {
    setSuporta(temWebGL());
  }, []);

  if (suporta === null) return <Reserva className={className} />;
  if (suporta === false) return <Reserva className={className} avatar={avatar} />;

  return (
    <LimiteDeErro reserva={<Reserva className={className} avatar={avatar} />}>
      <Cena avatar={avatar} className={className} animar={animar} celebra={celebra} />
    </LimiteDeErro>
  );
}

/**
 * O mesmo enquadramento da cena, em SVG: o planeta nascendo na base e o
 * personagem em cima. Com `avatar` mostra o bonequinho de `Personagem3D` (que
 * sem WebGL já cai no SVG); sem `avatar` é só o palco vazio esperando o canvas.
 */
function Reserva({ avatar, className }: { avatar?: AvatarType; className?: string }) {
  return (
    <div
      className={className}
      aria-hidden
      data-cena="reserva"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "-38%",
          width: "74%",
          transform: "translateX(-50%)",
          aspectRatio: "1 / 1",
        }}
      >
        <GloboSVG />
      </div>

      {avatar && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "38%",
            width: "36%",
            maxWidth: 150,
            transform: "translateX(-50%)",
            aspectRatio: "3 / 4",
          }}
        >
          <Personagem3D avatar={avatar} tamanhoReserva={120} />
        </div>
      )}
    </div>
  );
}

/**
 * Globo chapado em SVG, na paleta do jogo: oceano violeta, continentes em
 * `beam`, gelo claro nos polos. Mesma ideia low-poly da cena — massas chapadas,
 * nenhuma textura.
 */
function GloboSVG() {
  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" role="presentation">
      <circle cx="100" cy="100" r="96" fill="#7c5cf0" opacity="0.14" />
      <circle cx="100" cy="100" r="88" fill="#241a4c" />
      <g fill="#16c491">
        <polygon points="72,44 106,38 122,62 104,84 76,78 64,60" />
        <polygon points="118,92 146,86 158,108 138,130 116,122" />
        <polygon points="52,100 82,96 92,120 70,142 48,126" />
        <polygon points="96,140 124,144 118,166 92,164" />
        <polygon points="142,58 162,66 156,80 138,74" />
      </g>
      <g fill="#e6e2f7" opacity="0.85">
        <polygon points="78,16 122,16 132,26 68,26" />
        <polygon points="84,182 118,182 124,174 78,174" />
      </g>
      <circle cx="100" cy="100" r="88" fill="none" stroke="#3ce7ad" strokeOpacity="0.28" strokeWidth="1.5" />
    </svg>
  );
}

/** Se a cena quebrar em tempo de execução, mostra a reserva e segue o jogo. */
class LimiteDeErro extends Component<{ reserva: ReactNode; children: ReactNode }, { caiu: boolean }> {
  state = { caiu: false };

  static getDerivedStateFromError() {
    return { caiu: true };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[mundo-3d] caiu para a reserva em SVG:", erro);
  }

  render() {
    return this.state.caiu ? this.props.reserva : this.props.children;
  }
}
