/**
 * Geometria do globo low-poly da tela inicial.
 *
 * O planeta é um icosaedro: o oceano é a esfera facetada inteira e os
 * continentes são as faces da mesma esfera, num nível de subdivisão maior,
 * empurradas alguns centésimos para fora. Como as massas de terra reaproveitam
 * a malha do oceano, as bordas casam sem costura e o resultado fica chapado,
 * sem textura nenhuma — a mesma linguagem do personagem (`Personagem.tsx`).
 *
 * O mapa é determinístico: continentes são calotas (direção + raio angular)
 * com a borda ondulada por senos. Não é a Terra e não quer ser — é um planeta
 * reconhecível como planeta, o assunto do BlindGuess.
 *
 * Nada aqui toca React: só devolve `BufferGeometry` pronta para um `<mesh>`,
 * e quem monta a cena descarta no desmonte.
 */

import { BufferAttribute, BufferGeometry, IcosahedronGeometry, Vector3 } from "three";

/** Calotas de terra: direção no globo e raio angular, em radianos. */
const CONTINENTES: { dir: [number, number, number]; raio: number }[] = [
  { dir: [0.18, 0.34, 0.92], raio: 0.62 }, // a massa grande, de frente
  { dir: [0.94, 0.06, 0.02], raio: 0.44 },
  { dir: [-0.58, 0.46, 0.52], raio: 0.4 },
  { dir: [-0.26, -0.66, 0.44], raio: 0.36 },
  { dir: [-0.82, -0.08, -0.5], raio: 0.47 },
  { dir: [0.3, 0.78, -0.42], raio: 0.3 },
  { dir: [0.52, -0.36, -0.74], raio: 0.22 },
  { dir: [0.06, -0.92, -0.32], raio: 0.15 }, // ilhas
  { dir: [0.72, 0.5, -0.46], raio: 0.12 },
];

/** Latitude (em seno) a partir da qual vira gelo. */
const GELO_NORTE = 0.9;
const GELO_SUL = -0.93;

const centro = new Vector3();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const eixo = new Vector3();

/** Ondulação da costa: some com o raio da calota e quebra o círculo perfeito. */
function ondula(p: Vector3): number {
  return (
    0.12 * Math.sin(4.1 * p.x + 2.3) * Math.sin(3.7 * p.y - 1.1) +
    0.07 * Math.sin(6.3 * p.z + 0.6) * Math.sin(5.1 * p.x - 2.2) +
    0.04 * Math.sin(9.7 * p.y + 1.9)
  );
}

function ehTerra(p: Vector3): boolean {
  const ruido = ondula(p);
  for (const { dir, raio } of CONTINENTES) {
    eixo.set(dir[0], dir[1], dir[2]).normalize();
    const angulo = Math.acos(Math.min(1, Math.max(-1, p.dot(eixo))));
    if (angulo < raio + ruido) return true;
  }
  return false;
}

export type PecasDoGlobo = {
  /** Esfera facetada inteira: o oceano. */
  oceano: BufferGeometry;
  /** Só as faces de continente, um degrau para fora. */
  terra: BufferGeometry;
  /** As calotas polares, no mesmo degrau da terra. */
  gelo: BufferGeometry;
};

/**
 * Monta as três peças do globo com raio 1.
 *
 * `detalhe` é a subdivisão do icosaedro dos continentes (3 = 1.280 faces,
 * o suficiente para costa legível; 2 = 320, para celular). O oceano vem um
 * nível abaixo, com piso em 2 para a silhueta continuar redonda.
 */
export function montaGlobo(detalhe = 3): PecasDoGlobo {
  // O oceano fica um nível abaixo da terra, mas nunca abaixo de 2: é ele que
  // desenha a silhueta do planeta, e um icosaedro grosseiro vira um caroço.
  const oceano = new IcosahedronGeometry(1, Math.max(2, detalhe - 1));
  const malha = new IcosahedronGeometry(1, detalhe);
  const posicoes = malha.getAttribute("position") as BufferAttribute;

  const terraTris: number[] = [];
  const geloTris: number[] = [];
  const DEGRAU = 1.035;

  for (let i = 0; i < posicoes.count; i += 3) {
    a.fromBufferAttribute(posicoes, i);
    b.fromBufferAttribute(posicoes, i + 1);
    c.fromBufferAttribute(posicoes, i + 2);
    centro.copy(a).add(b).add(c).divideScalar(3).normalize();

    const polar = centro.y > GELO_NORTE || centro.y < GELO_SUL;
    const destino = polar ? geloTris : ehTerra(centro) ? terraTris : null;
    if (!destino) continue;

    for (const v of [a, b, c]) {
      destino.push(v.x * DEGRAU, v.y * DEGRAU, v.z * DEGRAU);
    }
  }

  malha.dispose();

  return {
    oceano,
    terra: deTriangulos(terraTris),
    gelo: deTriangulos(geloTris),
  };
}

function deTriangulos(valores: number[]): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(valores), 3));
  geo.computeVertexNormals();
  return geo;
}
