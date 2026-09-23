"use client";

import type { HatId } from "@/lib/types";
import type { Materiais } from "./materiais";
import { R_CABECA } from "./medidas";

/** Altura da testa: abas e faixas param aqui, acima dos olhos. */
const Y_TESTA = 0.21;

/**
 * Os nove chapéus, em 3D. Coordenadas relativas ao centro da cabeça, frente no
 * +z. Todos são combinações de primitivas: meia-esfera para copa, cilindro
 * achatado (inteiro ou meio) para aba, toro para faixa e aro, cone para ponta.
 *
 * Cada um é a leitura 3D do equivalente em SVG — nenhum item da loja
 * (`src/lib/shop.ts`) fica sem forma.
 */
export default function Chapeu({
  hat,
  mats,
}: {
  hat: HatId;
  mats: Materiais;
}) {
  switch (hat) {
    case "cap":
      return <Bone mats={mats} />;
    case "explorer":
      return <Explorador mats={mats} />;
    case "beanie":
      return <Gorro mats={mats} />;
    case "headphones":
      return <Fone mats={mats} />;
    case "bucket":
      return <Bucket mats={mats} />;
    case "visor":
      return <Viseira mats={mats} />;
    case "helmet":
      return <Capacete mats={mats} />;
    case "crown":
      return <Coroa mats={mats} />;
    default:
      return null;
  }
}

/** Meia-esfera de copa, encaixada na cabeça. */
function Copa({
  raio,
  abertura,
  material,
  y = 0,
}: {
  raio: number;
  abertura: number;
  material: Materiais[keyof Materiais];
  y?: number;
}) {
  return (
    <mesh position={[0, y, 0]} material={material}>
      <sphereGeometry args={[raio, 24, 14, 0, Math.PI * 2, 0, abertura]} />
    </mesh>
  );
}

/** Aba só na frente: metade de um cilindro achatado, inclinada para baixo. */
function MeiaAba({
  raio,
  espessura,
  material,
  y,
  z = 0,
  inclinacao = 0.14,
  escalaZ = 1,
}: {
  raio: number;
  espessura: number;
  material: Materiais[keyof Materiais];
  y: number;
  z?: number;
  inclinacao?: number;
  escalaZ?: number;
}) {
  return (
    <mesh
      position={[0, y, z]}
      rotation={[inclinacao, 0, 0]}
      scale={[1, 1, escalaZ]}
      material={material}
    >
      <cylinderGeometry
        args={[raio, raio, espessura, 20, 1, false, -Math.PI / 2, Math.PI]}
      />
    </mesh>
  );
}

/** Boné: copa colada na cabeça e aba curva na frente. */
function Bone({ mats }: { mats: Materiais }) {
  return (
    <group>
      <Copa raio={R_CABECA * 1.04} abertura={Math.PI * 0.45} material={mats.detalhe} y={0.01} />
      <MeiaAba
        raio={R_CABECA * 0.96}
        espessura={0.06}
        material={mats.detalheEscuro}
        y={Y_TESTA}
        z={0.08}
        escalaZ={1.2}
      />
      <mesh position={[0, R_CABECA * 0.98, 0]} material={mats.detalheEscuro}>
        <sphereGeometry args={[0.05, 10, 8]} />
      </mesh>
    </group>
  );
}

/** Chapéu de explorador: aba larga inteira, copa cônica e fita na cor da roupa. */
function Explorador({ mats }: { mats: Materiais }) {
  return (
    <group position={[0, Y_TESTA + 0.02, 0]}>
      <mesh position={[0, 0, 0]} scale={[1, 1, 0.92]} material={mats.detalhe}>
        <cylinderGeometry args={[0.84, 0.78, 0.06, 28]} />
      </mesh>
      <mesh position={[0, 0.16, 0]} material={mats.detalhe}>
        <cylinderGeometry args={[0.44, 0.52, 0.32, 24]} />
      </mesh>
      <Copa raio={0.44} abertura={Math.PI * 0.5} material={mats.detalhe} y={0.31} />
      <mesh position={[0, 0.07, 0]} material={mats.roupa}>
        <cylinderGeometry args={[0.535, 0.535, 0.1, 24]} />
      </mesh>
    </group>
  );
}

/** Gorro: copa alta, barra enrolada e pompom. */
function Gorro({ mats }: { mats: Materiais }) {
  const raio = R_CABECA * 1.1;
  const abertura = Math.PI * 0.4;
  const yBarra = raio * Math.cos(abertura);
  return (
    <group>
      <Copa raio={raio} abertura={abertura} material={mats.detalhe} />
      <mesh position={[0, yBarra, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.detalheEscuro}>
        <torusGeometry args={[raio * 0.93, 0.085, 8, 24]} />
      </mesh>
      <mesh position={[0, raio + 0.1, 0]} material={mats.detalheEscuro}>
        <sphereGeometry args={[0.12, 14, 10]} />
      </mesh>
    </group>
  );
}

/** Fone: arco por cima da cabeça e duas conchas nas orelhas. */
function Fone({ mats }: { mats: Materiais }) {
  const raio = R_CABECA * 1.12;
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI * 0.16]} material={mats.detalhe}>
        <torusGeometry args={[raio, 0.05, 8, 24, Math.PI * 0.68]} />
      </mesh>
      {[-1, 1].map((lado) => (
        <group key={lado} position={[lado * raio * 0.98, -0.04, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={mats.detalhe}>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 18]} />
          </mesh>
          <mesh position={[lado * 0.07, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.tinta}>
            <cylinderGeometry args={[0.12, 0.12, 0.04, 16]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Bucket: copa reta e aba larga caindo em volta. */
function Bucket({ mats }: { mats: Materiais }) {
  return (
    <group position={[0, Y_TESTA + 0.04, 0]}>
      <mesh position={[0, 0.2, 0]} material={mats.detalhe}>
        <cylinderGeometry args={[0.48, 0.56, 0.36, 24]} />
      </mesh>
      <mesh position={[0, 0, 0]} material={mats.detalheEscuro}>
        <cylinderGeometry args={[0.57, 0.78, 0.13, 26]} />
      </mesh>
    </group>
  );
}

/** Viseira: aro aberto na testa, sem copa, com aba na frente. */
function Viseira({ mats }: { mats: Materiais }) {
  return (
    <group>
      <mesh position={[0, Y_TESTA + 0.07, 0]} material={mats.detalhe}>
        <cylinderGeometry args={[R_CABECA * 1.03, R_CABECA * 1.03, 0.15, 24, 1, true]} />
      </mesh>
      <MeiaAba
        raio={R_CABECA * 1.12}
        espessura={0.055}
        material={mats.detalheEscuro}
        y={Y_TESTA + 0.02}
        z={0.05}
        inclinacao={0.18}
        escalaZ={1.05}
      />
    </group>
  );
}

/** Capacete: casco fechado, crista central na cor da roupa e aro na borda. */
function Capacete({ mats }: { mats: Materiais }) {
  const raio = R_CABECA * 1.09;
  const abertura = Math.PI * 0.41;
  const yAro = raio * Math.cos(abertura);
  return (
    <group>
      <Copa raio={raio} abertura={abertura} material={mats.detalhe} />
      <group rotation={[0, Math.PI / 2, 0]}>
        <mesh rotation={[0, 0, Math.PI * 0.22]} scale={[1, 1.03, 1]} material={mats.roupa}>
          <torusGeometry args={[raio * 0.99, 0.08, 8, 22, Math.PI * 0.58]} />
        </mesh>
      </group>
      <mesh position={[0, yAro, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.detalheEscuro}>
        <torusGeometry args={[raio * 0.92, 0.055, 8, 24]} />
      </mesh>
    </group>
  );
}

/** Coroa: aro sobre a cabeça com cinco pontas e pedras na cor da roupa. */
function Coroa({ mats }: { mats: Materiais }) {
  const pontas = 5;
  const raio = 0.44;
  return (
    <group position={[0, 0.3, 0]}>
      <mesh material={mats.detalhe}>
        <cylinderGeometry args={[raio, raio, 0.14, 20, 1, true]} />
      </mesh>
      {Array.from({ length: pontas }, (_, i) => {
        const angulo = (i / pontas) * Math.PI * 2;
        const x = Math.sin(angulo) * raio;
        const z = Math.cos(angulo) * raio;
        return (
          <group key={i} position={[x, 0.07, z]}>
            <mesh position={[0, 0.11, 0]} material={mats.detalhe}>
              <coneGeometry args={[0.085, 0.24, 10]} />
            </mesh>
            <mesh position={[0, 0.25, 0]} material={mats.roupa}>
              <sphereGeometry args={[0.045, 10, 8]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
