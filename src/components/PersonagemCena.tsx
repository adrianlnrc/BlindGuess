"use client";

import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { Material, Mesh, PerspectiveCamera } from "three";
import type { Avatar } from "@/lib/types";
import Personagem from "@/components/three/Personagem";
import { useAbaVisivel, usePrefereMenosMovimento } from "@/components/three/preferencias";
import { distanciaCamera, ENQUADRAMENTO, FOV, type Enquadramento } from "./enquadramento";

export type PersonagemCenaProps = {
  avatar: Avatar;
  className?: string;
  rotationY?: number;
  animar?: boolean;
  enquadramento?: Enquadramento;
};

/**
 * Cena do provador.
 *
 * O personagem é o mesmo de `src/components/three` — nada de mesh novo. Este
 * módulo inteiro só é carregado sob demanda (quem o importa é o
 * `PersonagemPalco`, por `next/dynamic`), que é o caminho que a fachada abre
 * para quem monta a própria cena. O que muda aqui é só a câmera: o `PersonagemCanvas` de lá tem
 * um enquadramento fixo, pensado para o retrato da tela inicial, e o provador
 * precisa de dois — um de corpo inteiro que caiba o chapéu mais alto com folga
 * e um de rosto, perto e na altura dos olhos, para julgar chapéu e rosto.
 *
 * Os cuidados de bateria seguem os mesmos: `dpr` limitado a 2, sem sombras, e o
 * loop só roda com animação de verdade.
 */
export default function PersonagemCena({
  avatar,
  className,
  rotationY = 0,
  animar = true,
  enquadramento = "corpo",
}: PersonagemCenaProps) {
  const reduzMovimento = usePrefereMenosMovimento();
  const abaVisivel = useAbaVisivel();
  const animando = animar && !reduzMovimento && abaVisivel;

  const { alvo, meiaAltura } = ENQUADRAMENTO[enquadramento];
  const distancia = distanciaCamera(meiaAltura);

  return (
    <div
      className={className}
      role="img"
      aria-label="Personagem do jogador em 3D"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <Canvas
        dpr={[1, 2]}
        shadows={false}
        frameloop={animando ? "always" : "demand"}
        camera={{ position: [0, 0, distancia], fov: FOV, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        style={{ width: "100%", height: "100%" }}
      >
        <Luzes />
        {/* A câmera olha para a origem: descer o personagem é mirar nele. */}
        <group position={[0, -alvo, 0]}>
          <Personagem avatar={avatar} animar={animando} rotationY={rotationY} />
        </group>
        <Camera distancia={distancia} />
        <Redesenha
          chaves={[
            avatar.skin,
            avatar.outfit,
            avatar.accent,
            avatar.hat,
            avatar.face,
            animando,
            rotationY,
            enquadramento,
          ]}
        />
        <Descarte />
      </Canvas>
    </div>
  );
}

/** Mesma luz chapada da cena da fachada: chave branca, preenchimento e contorno. */
function Luzes() {
  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[2.4, 3.4, 3.2]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-3, 1.2, 1.8]} intensity={0.5} color="#3ce7ad" />
      <directionalLight position={[0, 2.2, -3.4]} intensity={0.75} color="#ffb454" />
    </>
  );
}

/**
 * Aplica a distância quando o enquadramento troca — o `camera` do `Canvas` só
 * vale na montagem. Sem transição: quem pediu menos movimento não quer viagem
 * de câmera, e trocar de item tem de ser imediato.
 */
function Camera({ distancia }: { distancia: number }) {
  const camera = useThree((estado) => estado.camera) as PerspectiveCamera;

  useEffect(() => {
    camera.position.set(0, 0, distancia);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, distancia]);

  return null;
}

/** Em `frameloop="demand"`, pede um quadro novo quando algo muda. */
function Redesenha({ chaves }: { chaves: unknown[] }) {
  const invalidate = useThree((estado) => estado.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, ...chaves]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Descarte explícito na saída, para não acumular contexto WebGL entre telas. */
function Descarte() {
  const gl = useThree((estado) => estado.gl);
  const scene = useThree((estado) => estado.scene);

  useEffect(
    () => () => {
      scene.traverse((objeto) => {
        const mesh = objeto as Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });

      const canvas = gl.domElement;
      gl.dispose();
      // Em StrictMode o canvas volta a ser usado; só mata o contexto se saiu.
      setTimeout(() => {
        if (!canvas.isConnected) gl.forceContextLoss?.();
      }, 0);
    },
    [gl, scene],
  );

  return null;
}
