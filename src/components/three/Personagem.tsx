"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { Avatar } from "@/lib/types";
import Chapeu from "./Chapeus";
import Rosto from "./Rostos";
import { useMateriais } from "./materiais";
import { R_CABECA, Y_CABECA } from "./medidas";

export type PersonagemProps = {
  avatar: Avatar;
  /** Liga a respiração/idle. Desligado quando quem chama respeita reduced-motion. */
  animar?: boolean;
  /** Deslocamento do personagem dentro da cena de quem chama. */
  position?: [number, number, number];
  /** Giro em torno do próprio eixo, em radianos. */
  rotationY?: number;
  escala?: number;
};

/**
 * O personagem do jogador em 3D: só o mesh, para entrar em qualquer cena.
 * Pés no y = 0, virado para o +z, altura ~2.3 unidades.
 *
 * Desenho original, low-poly: cabeça esférica grande, tronco em cápsula,
 * braços e pernas curtos e arredondados, sem dedos nem detalhe fino. O rosto e
 * o chapéu são peças sólidas encostadas na cabeça.
 */
export default function Personagem({
  avatar,
  animar = true,
  position,
  rotationY = 0,
  escala = 1,
}: PersonagemProps) {
  const mats = useMateriais(avatar);
  const corpo = useRef<Group>(null);
  const cabeca = useRef<Group>(null);
  const bracoEsq = useRef<Group>(null);
  const bracoDir = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!animar) return;
    const t = clock.getElapsedTime();
    const respira = Math.sin(t * 1.5);

    if (corpo.current) {
      corpo.current.scale.set(1 + respira * 0.014, 1 - respira * 0.01, 1 + respira * 0.014);
      corpo.current.position.y = respira * 0.012;
    }
    if (cabeca.current) {
      cabeca.current.position.y = Y_CABECA + respira * 0.022;
      cabeca.current.rotation.y = Math.sin(t * 0.45) * 0.14;
      cabeca.current.rotation.z = Math.sin(t * 0.7) * 0.03;
    }
    if (bracoEsq.current) bracoEsq.current.rotation.x = Math.sin(t * 1.5) * 0.06;
    if (bracoDir.current) bracoDir.current.rotation.x = Math.sin(t * 1.5 + 0.6) * 0.06;
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={escala}>
      {/* tronco, braços e pernas respiram juntos */}
      <group ref={corpo}>
        {/* pernas curtas e pés arredondados */}
        {[-1, 1].map((lado) => (
          <group key={lado} position={[lado * 0.19, 0, 0]}>
            <mesh position={[0, 0.38, 0]} material={mats.calca}>
              <capsuleGeometry args={[0.135, 0.3, 4, 12]} />
            </mesh>
            <mesh position={[0, 0.1, 0.05]} scale={[1, 0.62, 1.35]} material={mats.tinta}>
              <sphereGeometry args={[0.16, 14, 10]} />
            </mesh>
          </group>
        ))}

        {/* tronco compacto, ombros um pouco mais largos que o quadril */}
        <mesh position={[0, 1.04, 0]} scale={[1.14, 1, 0.84]} material={mats.roupa}>
          <capsuleGeometry args={[0.31, 0.42, 6, 18]} />
        </mesh>
        {/* gola: pedaço de pele entre tronco e cabeça */}
        <mesh position={[0, 1.38, 0]} material={mats.pele}>
          <cylinderGeometry args={[0.15, 0.17, 0.16, 14]} />
        </mesh>

        {/* braços: giram no ombro, e ombro, braço e mão se encostam sem vão */}
        {[
          { lado: -1, ref: bracoEsq },
          { lado: 1, ref: bracoDir },
        ].map(({ lado, ref }) => (
          <group
            key={lado}
            ref={ref}
            position={[lado * 0.32, 1.27, 0]}
            rotation={[0, 0, lado * 0.3]}
          >
            {/* bola do ombro, enfiada no tronco para fechar a junta */}
            <mesh position={[0, -0.02, 0]} material={mats.roupa}>
              <sphereGeometry args={[0.135, 14, 10]} />
            </mesh>
            <mesh position={[0, -0.24, 0]} material={mats.roupa}>
              <capsuleGeometry args={[0.105, 0.34, 4, 12]} />
            </mesh>
            {/* a mão encaixa na ponta da cápsula, com sobreposição */}
            <mesh position={[0, -0.545, 0]} material={mats.pele}>
              <sphereGeometry args={[0.13, 14, 10]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* cabeça grande e redonda: rosto e chapéu andam com ela */}
      <group ref={cabeca} position={[0, Y_CABECA, 0]}>
        <mesh material={mats.pele}>
          <sphereGeometry args={[R_CABECA, 28, 20]} />
        </mesh>
        {/* orelhas */}
        {[-1, 1].map((lado) => (
          <mesh
            key={lado}
            position={[lado * R_CABECA * 0.95, -0.03, 0]}
            scale={[0.55, 1, 0.8]}
            material={mats.pele}
          >
            <sphereGeometry args={[0.11, 12, 8]} />
          </mesh>
        ))}
        <Rosto face={avatar.face} mats={mats} />
        <Chapeu hat={avatar.hat} mats={mats} />
      </group>
    </group>
  );
}
