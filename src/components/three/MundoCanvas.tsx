"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  RingGeometry,
  type Group,
  type Material,
  type Mesh,
  type Points,
} from "three";
import type { Avatar } from "@/lib/types";
import Personagem from "./Personagem";
import { montaGlobo } from "./globo";
import { ALTURA } from "./medidas";
import { useAbaVisivel, usePrefereMenosMovimento } from "./preferencias";

/** Cores da cena, tiradas de `src/app/globals.css`. */
const OCEANO = "#241a4c";
const OCEANO_FUNDO = "#150f2c";
const TERRA = "#16c491";
const TERRA_ALTO = "#3ce7ad";
const GELO = "#e6e2f7";
const HALO = "#7c5cf0";
const ESTRELA = "#a79cc0";

/** Raio do planeta e onde ele fica — o topo dele é o chão do personagem. */
const RAIO = 1.25;
const CENTRO_Y = -1.05;
const TOPO = CENTRO_Y + RAIO;
const ESCALA_PERSONAGEM = 0.5;

export type MundoCanvasProps = {
  avatar: Avatar;
  className?: string;
  /** Desliga a animação mesmo sem `prefers-reduced-motion`. */
  animar?: boolean;
  /**
   * Contador de celebrações: qualquer mudança dispara um pulso de nível novo.
   * Zero = nada a celebrar.
   */
  celebra?: number;
};

/**
 * A cena da tela inicial: o personagem em pé sobre o globo.
 *
 * Mesmos cuidados da cena do personagem (`PersonagemCanvas.tsx`): `dpr` preso,
 * sem sombra, sem antialias no celular, e o loop só roda quando há movimento de
 * verdade — com `prefers-reduced-motion` ou aba escondida o canvas vira
 * `frameloop="demand"` e desenha um quadro por mudança. Tudo que é geometria ou
 * material vive num `useMemo` e é descartado no desmonte.
 */
export default function MundoCanvas({ avatar, className, animar = true, celebra = 0 }: MundoCanvasProps) {
  const reduzMovimento = usePrefereMenosMovimento();
  const abaVisivel = useAbaVisivel();
  const animando = animar && !reduzMovimento && abaVisivel;

  // Celular: menos subdivisão no planeta e sem antialias.
  const pequeno = useMemo(() => typeof window !== "undefined" && window.innerWidth < 640, []);

  return (
    <div
      className={className}
      // A cena é decoração: não recebe clique nem leitura de tela. Quem precisa
      // do personagem para valer tem o editor de avatar.
      aria-hidden
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        pointerEvents: "none",
      }}
      data-cena="mundo"
    >
      <Canvas
        dpr={[1, pequeno ? 1.5 : 2]}
        shadows={false}
        frameloop={animando ? "always" : "demand"}
        camera={{ position: [0, 0.2, 6.2], fov: 30, near: 0.1, far: 40 }}
        gl={{ antialias: !pequeno, alpha: true, powerPreference: "low-power" }}
        style={{ width: "100%", height: "100%" }}
      >
        <Luzes />
        <Estrelas quantidade={pequeno ? 44 : 80} animando={animando} />

        <Globo detalhe={pequeno ? 2 : 3} animando={animando} celebra={celebra} />

        <group position={[0, TOPO - 0.02, 0]} scale={ESCALA_PERSONAGEM}>
          <Personagem avatar={avatar} animar={animando} rotationY={0.42} />
        </group>

        <Redesenha
          chaves={[avatar.skin, avatar.outfit, avatar.accent, avatar.hat, avatar.face, animando, celebra]}
        />
        <Descarte />
      </Canvas>
    </div>
  );
}

/**
 * Luz barata e sem sombra, na mesma receita do personagem: ambiente para
 * segurar a cor chapada, uma chave branca na frente, preenchimento verde de um
 * lado e contorno âmbar atrás, para nada sumir no violeta do fundo.
 */
function Luzes() {
  return (
    <>
      <ambientLight intensity={1.05} />
      <directionalLight position={[2.4, 3.4, 3.2]} intensity={1.45} color="#ffffff" />
      <directionalLight position={[-3, 1.2, 1.8]} intensity={0.5} color="#3ce7ad" />
      <directionalLight position={[0, 2.2, -3.4]} intensity={0.8} color="#ffb454" />
    </>
  );
}

/**
 * O planeta: oceano facetado, continentes chapados um degrau acima, calotas de
 * gelo e um halo de atmosfera. Gira devagar em torno do próprio eixo inclinado.
 */
function Globo({ detalhe, animando, celebra }: { detalhe: number; animando: boolean; celebra: number }) {
  const gira = useRef<Group>(null);

  const pecas = useMemo(() => montaGlobo(detalhe), [detalhe]);

  const materiais = useMemo(() => {
    const oceano = new MeshStandardMaterial({
      color: new Color(OCEANO),
      roughness: 0.55,
      metalness: 0,
      flatShading: true,
      emissive: new Color(OCEANO_FUNDO),
      emissiveIntensity: 0.5,
    });
    const terra = new MeshStandardMaterial({
      color: new Color(TERRA),
      roughness: 0.68,
      metalness: 0,
      flatShading: true,
      emissive: new Color(TERRA_ALTO),
      emissiveIntensity: 0,
    });
    const gelo = new MeshStandardMaterial({
      color: new Color(GELO),
      roughness: 0.5,
      metalness: 0,
      flatShading: true,
    });
    const halo = new MeshBasicMaterial({
      color: new Color(HALO),
      transparent: true,
      opacity: 0.16,
      side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    return { oceano, terra, gelo, halo };
  }, []);

  useEffect(
    () => () => {
      pecas.oceano.dispose();
      pecas.terra.dispose();
      pecas.gelo.dispose();
    },
    [pecas],
  );

  useEffect(
    () => () => {
      for (const material of Object.values(materiais)) material.dispose();
    },
    [materiais],
  );

  useFrame((_, delta) => {
    if (!animando || !gira.current) return;
    // Uma volta a cada ~100 s: dá para perceber o movimento sem distrair de
    // ninguém lendo a interface ao lado.
    gira.current.rotation.y += delta * 0.063;
  });

  return (
    <group position={[0, CENTRO_Y, 0]} rotation={[0, 0, 0.17]}>
      {/* Atmosfera: uma casca por dentro, sem escrever no depth. */}
      <mesh geometry={pecas.oceano} material={materiais.halo} scale={RAIO * 1.14} />

      <group ref={gira}>
        <mesh geometry={pecas.oceano} material={materiais.oceano} scale={RAIO} />
        <mesh geometry={pecas.terra} material={materiais.terra} scale={RAIO} />
        <mesh geometry={pecas.gelo} material={materiais.gelo} scale={RAIO} />
      </group>

      <Comemoracao
        key={celebra}
        ativa={celebra > 0 && animando}
        terra={materiais.terra}
        halo={materiais.halo}
      />
    </group>
  );
}

/**
 * O instante de nível novo: uma onda que sai do planeta e um brilho curto nos
 * continentes. Dura menos de um segundo e meio e não bloqueia nada — quem
 * quiser jogar de novo clica por cima sem esperar.
 */
function Comemoracao({
  ativa,
  terra,
  halo,
}: {
  ativa: boolean;
  terra: MeshStandardMaterial;
  halo: MeshBasicMaterial;
}) {
  const onda = useRef<Mesh>(null);
  const tempo = useRef(0);
  const DURACAO = 1.4;

  const geometria = useMemo(() => new RingGeometry(1, 1.05, 64), []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(TERRA_ALTO),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometria.dispose();
      material.dispose();
      // Devolve o brilho emprestado aos continentes.
      terra.emissiveIntensity = 0;
      halo.opacity = 0.16;
    },
    [geometria, material, terra, halo],
  );

  useFrame((_, delta) => {
    if (!ativa) return;
    tempo.current += delta;
    const t = Math.min(1, tempo.current / DURACAO);
    const fim = 1 - (1 - t) ** 3;

    if (onda.current) {
      const escala = RAIO * (1 + fim * 1.1);
      onda.current.scale.setScalar(escala);
      material.opacity = 0.75 * (1 - t) ** 1.5;
    }
    terra.emissiveIntensity = 0.55 * Math.sin(Math.PI * t) ** 2;
    halo.opacity = 0.16 + 0.22 * Math.sin(Math.PI * t) ** 2;
  });

  if (!ativa) return null;

  return (
    <mesh ref={onda} geometry={geometria} material={material} rotation={[-Math.PI / 2, 0, 0]} scale={RAIO} />
  );
}

/** Poeira de estrelas atrás do planeta, para a cena ter profundidade barata. */
function Estrelas({ quantidade, animando }: { quantidade: number; animando: boolean }) {
  const pontos = useRef<Points>(null);

  const geometria = useMemo(() => {
    const aleatorio = mulberry32(20260923);
    const valores: number[] = [];
    while (valores.length < quantidade * 3) {
      // Só o hemisfério de trás: estrela na frente do planeta ficaria estranha.
      const u = aleatorio() * 2 - 1;
      const angulo = aleatorio() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const z = Math.sin(angulo) * r;
      if (z > -0.25) continue;
      const raio = 9 + aleatorio() * 6;
      valores.push(Math.cos(angulo) * r * raio, u * raio * 0.7, z * raio);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(valores), 3));
    return geo;
  }, [quantidade]);

  const material = useMemo(
    () =>
      new PointsMaterial({
        color: new Color(ESTRELA),
        size: 0.09,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometria.dispose();
      material.dispose();
    },
    [geometria, material],
  );

  useFrame(({ clock }) => {
    if (!animando || !pontos.current) return;
    pontos.current.rotation.y = clock.getElapsedTime() * 0.008;
  });

  return <points ref={pontos} geometry={geometria} material={material} />;
}

/** PRNG pequeno e determinístico: a mesma constelação em toda visita. */
function mulberry32(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
 * Descarte explícito no desmonte: varre a cena liberando geometrias e
 * materiais, devolve os recursos do renderizador e, se o canvas saiu do
 * documento de verdade, força a perda do contexto WebGL.
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
      setTimeout(() => {
        if (!canvas.isConnected) gl.forceContextLoss?.();
      }, 0);
    },
    [gl, scene],
  );

  return null;
}

/** Altura total do personagem na escala usada pela cena — útil para enquadrar. */
export const ALTURA_NA_CENA = ALTURA * ESCALA_PERSONAGEM;
