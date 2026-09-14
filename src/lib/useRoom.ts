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

  useEffect(() => {
    const socket = getSocket();

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

  const playerId = typeof window === "undefined" ? undefined : storedPlayerId(code);
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

  return { state, me, status, error, updateSettings, startGame, nextRound, playAgain, submitGuess };
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
