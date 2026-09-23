"use client";

import { useEffect, useState } from "react";

/** Verdadeiro quando o sistema pede menos movimento (`prefers-reduced-motion`). */
export function usePrefereMenosMovimento(): boolean {
  const [reduz, setReduz] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduz(consulta.matches);
    const muda = (e: MediaQueryListEvent) => setReduz(e.matches);
    consulta.addEventListener("change", muda);
    return () => consulta.removeEventListener("change", muda);
  }, []);

  return reduz;
}

/** Verdadeiro enquanto a aba está visível — para não animar em segundo plano. */
export function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(true);

  useEffect(() => {
    const muda = () => setVisivel(document.visibilityState === "visible");
    muda();
    document.addEventListener("visibilitychange", muda);
    return () => document.removeEventListener("visibilitychange", muda);
  }, []);

  return visivel;
}
