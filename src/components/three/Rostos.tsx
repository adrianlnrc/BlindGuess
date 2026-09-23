"use client";

import type { FaceId } from "@/lib/types";
import type { Materiais } from "./materiais";
import { R_CABECA, zRosto } from "./medidas";

/**
 * Os sete rostos, em 3D. Coordenadas relativas ao centro da cabeça; a frente é
 * o +z. Cada peça é uma primitiva sólida encostada na casca da cabeça, então o
 * rosto acompanha a curvatura sem precisar de textura.
 *
 * Tradução do SVG: olho redondo = esfera, olho fechado/franzido = arco de toro
 * ou caixa achatada, boca = arco de toro, lente = anel de toro, vidro escuro e
 * tapa-olho = esfera achatada.
 */

const OLHO_X = 0.2;
const OLHO_Y = 0.07;
const BOCA_Y = -0.145;

export default function Rosto({ face, mats }: { face: FaceId; mats: Materiais }) {
  return (
    <group>
      {face === "shades" ? <Escuros mats={mats} /> : <Olhos face={face} mats={mats} />}
      {face === "glasses" && <Oculos mats={mats} />}
      {face === "eyepatch" && <TapaOlho mats={mats} />}
      <Boca face={face} mats={mats} />
    </group>
  );
}

/** Olho redondo padrão. */
function OlhoRedondo({ x, mats }: { x: number; mats: Materiais }) {
  return (
    <mesh position={[x, OLHO_Y, zRosto(x, OLHO_Y)]} material={mats.tinta}>
      <sphereGeometry args={[0.075, 14, 10]} />
    </mesh>
  );
}

/** Olho fechado: arco fino virado para cima, como a piscadinha do SVG. */
function OlhoArco({ x, mats }: { x: number; mats: Materiais }) {
  return (
    <mesh
      position={[x, OLHO_Y, zRosto(x, OLHO_Y, 0.015)]}
      rotation={[0, x < 0 ? -0.22 : 0.22, 0]}
      material={mats.tinta}
    >
      <torusGeometry args={[0.072, 0.022, 6, 12, Math.PI]} />
    </mesh>
  );
}

/** Olho franzido: barra horizontal, o "focado" do SVG. */
function OlhoBarra({ x, mats }: { x: number; mats: Materiais }) {
  return (
    <mesh
      position={[x, OLHO_Y, zRosto(x, OLHO_Y, 0.02)]}
      rotation={[0, x < 0 ? -0.22 : 0.22, 0]}
      material={mats.tinta}
    >
      <boxGeometry args={[0.15, 0.042, 0.05]} />
    </mesh>
  );
}

function Olhos({ face, mats }: { face: FaceId; mats: Materiais }) {
  if (face === "focused") {
    return (
      <>
        <OlhoBarra x={-OLHO_X} mats={mats} />
        <OlhoBarra x={OLHO_X} mats={mats} />
      </>
    );
  }

  if (face === "wink") {
    return (
      <>
        <OlhoArco x={-OLHO_X} mats={mats} />
        <OlhoRedondo x={OLHO_X} mats={mats} />
      </>
    );
  }

  return (
    <>
      <OlhoRedondo x={-OLHO_X} mats={mats} />
      <OlhoRedondo x={OLHO_X} mats={mats} />
    </>
  );
}

/** Óculos de grau: dois anéis na cor do detalhe, com ponte e hastes. */
function Oculos({ mats }: { mats: Materiais }) {
  const z = zRosto(OLHO_X, OLHO_Y, -0.03);
  return (
    <group>
      {[-OLHO_X, OLHO_X].map((x) => (
        <mesh
          key={x}
          position={[x, OLHO_Y, z]}
          rotation={[0, x < 0 ? -0.26 : 0.26, 0]}
          material={mats.detalhe}
        >
          <torusGeometry args={[0.115, 0.02, 6, 16]} />
        </mesh>
      ))}
      <mesh position={[0, OLHO_Y, zRosto(0, OLHO_Y, -0.01)]} material={mats.detalhe}>
        <boxGeometry args={[0.12, 0.022, 0.022]} />
      </mesh>
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[lado * 0.38, OLHO_Y, 0.16]}
          rotation={[0, lado * 0.9, 0]}
          material={mats.detalhe}
        >
          <boxGeometry args={[0.3, 0.022, 0.022]} />
        </mesh>
      ))}
    </group>
  );
}

/** Óculos escuros: duas lentes achatadas e escuras com ponte, sem olho atrás. */
function Escuros({ mats }: { mats: Materiais }) {
  return (
    <group>
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[lado * 0.2, OLHO_Y + 0.01, zRosto(0.2, OLHO_Y, -0.015)]}
          rotation={[0, lado * 0.32, 0]}
          scale={[1, 0.8, 0.28]}
          material={mats.tinta}
        >
          <sphereGeometry args={[0.155, 16, 10]} />
        </mesh>
      ))}
      <mesh position={[0, OLHO_Y + 0.02, zRosto(0, OLHO_Y, -0.01)]} material={mats.tinta}>
        <boxGeometry args={[0.14, 0.04, 0.04]} />
      </mesh>
      {[-1, 1].map((lado) => (
        <mesh
          key={lado}
          position={[lado * 0.4, OLHO_Y + 0.02, 0.14]}
          rotation={[0, lado * 0.95, 0]}
          material={mats.tinta}
        >
          <boxGeometry args={[0.3, 0.028, 0.028]} />
        </mesh>
      ))}
    </group>
  );
}

/** Tapa-olho: disco escuro sobre o olho esquerdo e tira em volta da cabeça. */
function TapaOlho({ mats }: { mats: Materiais }) {
  return (
    <group>
      <mesh
        position={[-0.2, OLHO_Y + 0.01, zRosto(0.2, OLHO_Y, -0.01)]}
        rotation={[0, -0.32, 0.1]}
        scale={[1, 1.05, 0.26]}
        material={mats.tinta}
      >
        <sphereGeometry args={[0.155, 16, 10]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, -0.26]} material={mats.tinta}>
        <torusGeometry args={[R_CABECA * 0.99, 0.018, 6, 24]} />
      </mesh>
    </group>
  );
}

/** Boca: arco para os rostos sorridentes, barra no focado, aberta no sorrisão. */
function Boca({ face, mats }: { face: FaceId; mats: Materiais }) {
  if (face === "focused") {
    return (
      <mesh position={[0, BOCA_Y, zRosto(0, BOCA_Y, 0.02)]} material={mats.tinta}>
        <boxGeometry args={[0.17, 0.035, 0.05]} />
      </mesh>
    );
  }

  if (face === "grin") {
    return (
      <group position={[0, BOCA_Y, zRosto(0, BOCA_Y, 0.02)]}>
        <mesh scale={[1.3, 0.9, 0.34]} material={mats.tinta}>
          <sphereGeometry args={[0.135, 16, 12]} />
        </mesh>
        <mesh position={[0, 0.05, 0.055]} material={mats.claro}>
          <boxGeometry args={[0.25, 0.038, 0.035]} />
        </mesh>
      </group>
    );
  }

  return (
    <mesh
      position={[0, BOCA_Y + 0.02, zRosto(0, BOCA_Y, 0.045)]}
      rotation={[0, 0, Math.PI]}
      material={mats.tinta}
    >
      <torusGeometry args={[0.115, 0.024, 6, 16, Math.PI]} />
    </mesh>
  );
}
