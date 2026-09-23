"use client";

import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { Material, Mesh } from "three";
import type { Avatar } from "@/lib/types";
import Personagem from "./Personagem";
import { useAbaVisivel, usePrefereMenosMovimento } from "./preferencias";

export type PersonagemCanvasProps = {
  avatar: Avatar;
  className?: string;
  /** Giro do personagem em radianos — útil para posar na tela inicial. */
  rotationY?: number;
  /** Força desligar a animação idle, mesmo sem reduced-motion. */
  animar?: boolean;
};

/**
 * Cena pronta com o personagem: câmera, luzes e respiração idle.
 *
 * Cuidados de celular e de bateria: `dpr` limitado a 2, sem sombras, e o loop
 * só roda quando há animação de verdade — se o sistema pede menos movimento ou
 * a aba está escondida, o canvas vira `frameloop="demand"` e desenha um quadro
 * por mudança.
 */
export default function PersonagemCanvas({
  avatar,
  className,
  rotationY = 0,
  animar = true,
}: PersonagemCanvasProps) {
  const reduzMovimento = usePrefereMenosMovimento();
  const abaVisivel = useAbaVisivel();
  const animando = animar && !reduzMovimento && abaVisivel;

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
        camera={{ position: [0, 0.25, 4.4], fov: 34, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        style={{ width: "100%", height: "100%" }}
      >
        <Luzes />
        <group position={[0, -1.2, 0]}>
          <Personagem avatar={avatar} animar={animando} rotationY={rotationY} />
        </group>
        <Redesenha chaves={[avatar.skin, avatar.outfit, avatar.accent, avatar.hat, avatar.face, animando, rotationY]} />
        <Descarte />
      </Canvas>
    </div>
  );
}

/**
 * Luz barata e sem sombra: ambiente para não perder a cor chapada, uma luz
 * chave na frente, um preenchimento verde (`beam`) de um lado e um contorno
 * âmbar (`flare`) atrás, para o boneco não sumir no violeta do fundo.
 */
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

/** Em `frameloop="demand"`, pede um quadro novo quando algo muda. */
function Redesenha({ chaves }: { chaves: unknown[] }) {
  const invalidate = useThree((estado) => estado.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, ...chaves]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Descarte explícito: no desmonte varre a cena liberando geometrias e
 * materiais, devolve os recursos do renderizador e, se o canvas realmente saiu
 * do documento, força a perda do contexto para não acumular contexto WebGL
 * entre navegações.
 */
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
