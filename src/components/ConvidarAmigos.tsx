"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "./Avatar";
import { getSocket } from "@/lib/socket";
import { loadProfile } from "@/lib/profile";
import type { Friend } from "@/lib/types";

/** Como está o convite para cada amigo, por profileId. */
export type EstadoConvite = Record<string, "enviando" | "chamado" | { erro: string }>;

/**
 * A ação de chamar, compartilhada pelo lobby e pela página de amigos.
 *
 * O evento não leva quem convida nem qual sala: as duas coisas vêm da conexão
 * no servidor. Daqui vai só o amigo escolhido — e é o servidor que confere a
 * amizade no banco.
 */
export function useConvidar(): {
  estado: EstadoConvite;
  convidar: (friend: Friend) => void;
} {
  const [estado, setEstado] = useState<EstadoConvite>({});

  const convidar = useCallback((friend: Friend) => {
    setEstado((atual) => ({ ...atual, [friend.profileId]: "enviando" }));

    getSocket().emit("convidarAmigo", { friendId: friend.profileId }, (res) => {
      setEstado((atual) => ({
        ...atual,
        [friend.profileId]: res.ok ? "chamado" : { erro: res.error },
      }));
    });
  }, []);

  return { estado, convidar };
}

/** Texto do botão para o estado atual do convite. */
function rotulo(estado: EstadoConvite[string] | undefined): string {
  if (estado === "enviando") return "Chamando…";
  if (estado === "chamado") return "Chamado ✓";
  return "Chamar";
}

/**
 * Amigos online, no lobby, com um botão para chamar cada um.
 *
 * Fica aqui porque é neste momento — sala aberta, esperando gente — que o
 * convite tem sentido: ninguém precisa mais sair do jogo para colar um código
 * em outro aplicativo.
 */
export default function ConvidarAmigos() {
  const [amigos, setAmigos] = useState<Friend[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { estado, convidar } = useConvidar();

  const recarrega = useCallback(() => {
    getSocket().emit("fetchFriends", (res) => {
      if (res.ok) {
        setAmigos(res.friends);
        setErro(null);
      } else {
        setAmigos([]);
        setErro(res.error);
      }
    });
  }, []);

  useEffect(() => {
    const socket = getSocket();

    // A conexão só conhece o perfil depois do `identify`; quem entrou na sala
    // por link direto pode não ter feito isso ainda.
    const identificaERecarrega = () => {
      const perfil = loadProfile();
      if (!perfil.id || !perfil.name) return;
      socket.emit("identify", { profile: perfil }, () => recarrega());
    };

    identificaERecarrega();
    socket.on("connect", identificaERecarrega);
    // A presença dos amigos muda sem aviso.
    const id = setInterval(recarrega, 20_000);

    return () => {
      socket.off("connect", identificaERecarrega);
      clearInterval(id);
    };
  }, [recarrega]);

  // Sem amigos cadastrados (ou sem banco) a seção não aparece: nada a oferecer.
  if (!amigos || amigos.length === 0) return null;

  const online = amigos.filter((a) => a.online);

  return (
    <section className="panel rounded-2xl p-6">
      <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
        Chamar amigos{" "}
        <span className="normal-case">
          ({online.length} de {amigos.length} online)
        </span>
      </h2>

      {erro && <p className="mt-3 text-sm text-flare-400">{erro}</p>}

      {online.length === 0 ? (
        <p className="mt-4 text-sm text-mist-300">
          Nenhum amigo com o jogo aberto agora. Enquanto isso, o código da sala ainda serve.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {online.map((amigo) => {
            const atual = estado[amigo.profileId];
            const falhou = typeof atual === "object";

            return (
              <li
                key={amigo.profileId}
                className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-950/50 px-4 py-3"
              >
                <div className="relative shrink-0">
                  <Avatar avatar={amigo.avatar} size={36} className="rounded-lg" />
                  <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-ink-900 bg-beam-400" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{amigo.name}</p>
                  {falhou && <p className="truncate text-xs text-flare-400">{atual.erro}</p>}
                </div>

                <button
                  type="button"
                  onClick={() => convidar(amigo)}
                  disabled={atual === "enviando" || atual === "chamado"}
                  className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-sm font-medium transition hover:border-beam-500 hover:text-beam-400 disabled:cursor-default disabled:border-ink-700 disabled:text-mist-300"
                >
                  {rotulo(atual)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
