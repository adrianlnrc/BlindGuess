/**
 * Detecção de WebGL. Serve para decidir, antes de carregar o Three.js, se dá
 * para mostrar o personagem 3D ou se o chamador deve cair no bonequinho SVG.
 */

let cache: boolean | null = null;

export function temWebGL(): boolean {
  if (cache !== null) return cache;
  if (typeof window === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    const contexto =
      (canvas.getContext("webgl2") as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);

    if (!contexto) {
      cache = false;
      return false;
    }

    // Devolve o contexto de sondagem na hora: o navegador aguenta poucos.
    const perder = contexto.getExtension("WEBGL_lose_context");
    perder?.loseContext();
    cache = true;
    return true;
  } catch {
    cache = false;
    return false;
  }
}
