"use client";

import { useCallback, useEffect, useState } from "react";
import { loadProfile } from "./profile";
import { getSocket, rememberPlayer, storedPlayerId } from "./socket";
import type { LatLng, RoomSettings, RoomState } from "./types";

export type JoinStatus = "connecting" | "joined" | "error";

/**
 * Conecta na sala `code`, mantem o estado sincronizado e expoe as acoes.
 * Reconecta sozinho usando o playerId guardado no localStorage.
 */
export function useRoom(code: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<JoinStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  /**
   * O assento nesta sala. Fica em estado, nao numa leitura do localStorage no
   * meio do render, por dois motivos: no servidor essa leitura nao existe, e
   * numa rejuncao o React descarta `setStatus("joined")` quando o status ja era
   * esse — sem re-render, um assento novo ficaria invisivel para a tela, e o
   * jogador se veria como outra pessoa (palpite que nao conta como dele, barra
   * de vida do adversario apontando para o lado errado).
   */
  const [playerId, setPlayerId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const socket = getSocket();
    // Cada sala tem o seu assento: entrar noutra nao pode herdar o anterior.
    setPlayerId(storedPlayerId(code));

    const join = () => {
      const profile = loadProfile();
      if (!profile.name) {
        setStatus("error");
        setError("Escolha um apelido na tela inicial para entrar na sala.");
        return;
      }

      socket.emit("joinRoom", { code, profile, playerId: storedPlayerId(code) }, (res) => {
        if (res.ok) {
          rememberPlayer(code, res.playerId);
          setPlayerId(res.playerId);
          setStatus("joined");
          setError(null);
        } else {
          setStatus("error");
          setError(res.error);
        }
      });
    };

    const onState = (next: RoomState) => setState(next);
    const onMessage = (message: string) => setError(message);

    socket.on("state", onState);
    socket.on("errorMessage", onMessage);
    socket.on("connect", join);

    if (socket.connected) join();

    return () => {
      socket.off("state", onState);
      socket.off("errorMessage", onMessage);
      socket.off("connect", join);
    };
  }, [code]);

  const me = state?.players.find((p) => p.id === playerId) ?? null;

  const updateSettings = useCallback((settings: Partial<RoomSettings>) => {
    getSocket().emit("updateSettings", { settings });
  }, []);

  const startGame = useCallback(() => getSocket().emit("startGame"), []);
  const nextRound = useCallback(() => getSocket().emit("nextRound"), []);
  const playAgain = useCallback(() => getSocket().emit("playAgain"), []);
  const submitGuess = useCallback(
    (position: LatLng) => getSocket().emit("submitGuess", { position }),
    [],
  );

  return {
    state,
    me,
    playerId,
    status,
    error,
    updateSettings,
    startGame,
    nextRound,
    playAgain,
    submitGuess,
  };
}

/** Segundos restantes ate `endsAt`, atualizado a cada 250 ms. */
export function useCountdown(endsAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) {
      setRemaining(null);
      return;
    }

    const tick = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  return remaining;
}
