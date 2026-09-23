"use client";

import { useEffect, useMemo } from "react";
import { Color, MeshStandardMaterial } from "three";
import type { Avatar } from "@/lib/types";

/** Cor dos traços do rosto — a mesma tinta do bonequinho SVG. */
export const TINTA = "#141d2e";
/** Branco levemente violeta, para dentes e brilhos. */
export const CLARO = "#f4f1ff";
/** Violeta do fundo do jogo (`--color-ink-950`), usado para escurecer cores. */
export const FUNDO = "#110b20";

export type Materiais = {
  pele: MeshStandardMaterial;
  roupa: MeshStandardMaterial;
  calca: MeshStandardMaterial;
  detalhe: MeshStandardMaterial;
  detalheEscuro: MeshStandardMaterial;
  tinta: MeshStandardMaterial;
  claro: MeshStandardMaterial;
};

function fosco(cor: Color | string, rugosidade = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(cor as string),
    roughness: rugosidade,
    metalness: 0,
  });
}

/**
 * Materiais do personagem: um por cor, compartilhados por todos os meshes.
 * São recriados quando as cores mudam e descartados no desmonte — nada de
 * material órfão pendurado no contexto WebGL.
 */
export function useMateriais(avatar: Avatar): Materiais {
  const materiais = useMemo<Materiais>(() => {
    return {
      pele: fosco(avatar.skin, 0.68),
      roupa: fosco(avatar.outfit),
      calca: fosco(new Color(avatar.outfit).lerp(new Color(FUNDO), 0.55)),
      detalhe: fosco(avatar.accent),
      detalheEscuro: fosco(new Color(avatar.accent).lerp(new Color(FUNDO), 0.3)),
      tinta: fosco(TINTA, 0.85),
      claro: fosco(CLARO, 0.5),
    };
  }, [avatar.skin, avatar.outfit, avatar.accent]);

  useEffect(
    () => () => {
      for (const material of Object.values(materiais)) material.dispose();
    },
    [materiais],
  );

  return materiais;
}
