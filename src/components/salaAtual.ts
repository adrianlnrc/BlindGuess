"use client";

/**
 * Qual sala esta aba está jogando agora.
 *
 * A página de amigos não assina o estado da sala, mas precisa saber se há sala
 * para oferecer "chamar para a minha sala". O `ConviteAviso`, que vive no layout
 * e vê todo `state`, anota aqui; quem quiser saber lê. Fica em `sessionStorage`
 * para sobreviver à navegação entre telas sem vazar para outras abas.
 *
 * É só uma dica de interface: o servidor continua sendo quem decide, porque a
 * sala de verdade está na conexão (`socket.data.roomCode`). Se este palpite
 * estiver velho, o convite volta com "Entre numa sala antes de chamar alguém."
 */

const CHAVE = "blindguess:salaAtual";

export function lembraSala(code: string): void {
  try {
    window.sessionStorage.setItem(CHAVE, code);
  } catch {
    // aba sem sessionStorage (modo privado antigo): seguimos sem a dica
  }
}

export function esqueceSala(): void {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
}

export function salaAtual(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}
