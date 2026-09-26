"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { esqueceSala, lembraSala } from "./salaAtual";
import { getSocket } from "@/lib/socket";
import type { Convite, RoomPhase } from "@/lib/types";

/** Convite mais velho que isto já não vale a pena mostrar. */
const VALIDADE_MS = 3 * 60 * 1000;

const MODO_LABEL: Record<Convite["mode"], string> = {
  party: "sala",
  duel: "duelo 1v1",
  challenge: "desafio",
  solo: "sala",
  streak: "sequência de países",
};

/**
 * Aviso de "um amigo te chamou", montado no layout para chegar em qualquer tela.
 *
 * Nunca é modal e nunca bloqueia nada. Durante uma rodada em andamento o aviso
 * encolhe para uma tarja discreta e sem botões, fora do HUD e do mapa de
 * palpite, e sem receber clique — quem está jogando não perde a rodada por causa
 * de um convite. Assim que a rodada termina (resultado, fim de partida ou
 * lobby), o mesmo convite aparece inteiro, com entrar e dispensar.
 */
export default function ConviteAviso() {
  const router = useRouter();
  const pathname = usePathname();
  const [convite, setConvite] = useState<Convite | null>(null);
  const [fase, setFase] = useState<RoomPhase | null>(null);
  const [minhaSala, setMinhaSala] = useState<string | null>(null);

  // Fora de uma sala não há rodada em andamento nem sala própria.
  const naSala = pathname?.startsWith("/room/") ?? false;
  useEffect(() => {
    if (naSala) return;
    setFase(null);
    setMinhaSala(null);
    esqueceSala();
  }, [naSala]);

  useEffect(() => {
    const socket = getSocket();

    const aoConvite = (payload: Convite) => {
      // Convite velho (a aba ficou em segundo plano, o servidor reenviou depois
      // de uma reconexão) morre aqui em vez de chamar para uma sala que já
      // esvaziou.
      if (!payload?.roomCode || Date.now() - payload.em > VALIDADE_MS) return;
      setConvite(payload);
    };

    const aoEstado = (state: { code: string; phase: RoomPhase }) => {
      setFase(state.phase);
      setMinhaSala(state.code);
      lembraSala(state.code);
    };

    socket.on("convite", aoConvite);
    socket.on("state", aoEstado);

    return () => {
      socket.off("convite", aoConvite);
      socket.off("state", aoEstado);
    };
  }, []);

  // Descarta sozinho quando o convite envelhece na tela.
  useEffect(() => {
    if (!convite) return;
    const resta = convite.em + VALIDADE_MS - Date.now();
    const id = setTimeout(() => setConvite(null), Math.max(0, resta));
    return () => clearTimeout(id);
  }, [convite]);

  if (!convite) return null;
  // Já estou exatamente onde o convite leva: não há nada a avisar.
  if (minhaSala && minhaSala === convite.roomCode) return null;

  const emRodada = fase === "playing";
  const onde = MODO_LABEL[convite.mode] ?? "sala";

  if (emRodada) {
    return (
      <div
        role="status"
        className="panel pointer-events-none fixed top-24 left-4 z-40 flex max-w-[15rem] items-center gap-2 rounded-xl px-3 py-2 opacity-90"
      >
        <Avatar avatar={convite.deAvatar} size={24} className="shrink-0 rounded-md" />
        <p className="truncate text-xs text-mist-300">
          <strong className="text-mist-100">{convite.deNome}</strong> te chamou · depois da rodada
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="panel fixed bottom-4 left-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl px-4 py-3 shadow-xl"
    >
      <Avatar avatar={convite.deAvatar} size={44} className="shrink-0 rounded-xl" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{convite.deNome} te chamou</p>
        <p className="text-sm text-mist-300">
          {onde} <span className="num tracking-widest">{convite.roomCode}</span>
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={() => {
            const destino = convite.roomCode;
            setConvite(null);
            router.push(`/room/${destino}`);
          }}
          className="rounded-lg bg-beam-500 px-3 py-1.5 text-sm font-semibold text-ink-950 transition hover:bg-beam-400"
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => setConvite(null)}
          className="rounded-lg border border-ink-600 px-3 py-1 text-xs text-mist-300 transition hover:border-ink-500"
        >
          Dispensar
        </button>
      </div>
    </div>
  );
}
