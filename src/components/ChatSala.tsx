"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { ZONA_CHAT } from "./hudZonas";
import { getSocket } from "@/lib/socket";
import { CHAT_MAX_CHARS, type ChatMessage } from "@/lib/types";

type Props = {
  /** Painel: fica aberto na coluna do lobby. Bolha: canto recolhível durante o jogo. */
  /** Código da sala: a memória das falas é por sala, não por aba. */
  code: string;
  variante: "painel" | "bolha";
  /** Assento de quem está lendo, para destacar as próprias falas. */
  meuId?: string;
};

/**
 * Quantas falas ficam na memória. O histórico não existe no servidor (ele iria
 * junto no `RoomState`, que já é reenviado a cada evento), então isto aqui é
 * tudo o que há — e um teto evita a aba crescer sem limite numa sala falante.
 */
const LIMITE_MEMORIA = 50;

/**
 * As falas vivem fora do componente porque ele é remontado quando a sala troca
 * de fase (lobby → rodada → resultado): sem isto a conversa sumiria a cada
 * mudança de tela, ainda estando a mesma gente na mesma sala.
 *
 * Mas é memória de UMA sala: trocar de sala na mesma aba tem que começar do
 * zero, senão a conversa da sala anterior reaparece na nova — e `contadas`
 * conta separado de `falas` porque, passado o teto, `falas.length` para de
 * crescer e o aviso de não lidas congelaria justo na sala mais falante.
 */
const memoria: { sala: string | null; falas: ChatMessage[]; contadas: number } = {
  sala: null,
  falas: [],
  contadas: 0,
};

function memoriaDaSala(code: string): typeof memoria {
  if (memoria.sala !== code) {
    memoria.sala = code;
    memoria.falas = [];
    memoria.contadas = 0;
  }
  return memoria;
}

/** Falas recebidas nesta aba enquanto ela estiver montada. */
function useFalas(code: string): {
  falas: ChatMessage[];
  enviar: (text: string) => void;
  erro: string | null;
  /** Só aumenta: o contador de não lidas é feito a partir dela. */
  recebidas: number;
} {
  const [falas, setFalas] = useState<ChatMessage[]>(() => [...memoriaDaSala(code).falas]);
  const [recebidas, setRecebidas] = useState(() => memoriaDaSala(code).contadas);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const atual = memoriaDaSala(code);
    setFalas([...atual.falas]);
    setRecebidas(atual.contadas);

    const socket = getSocket();
    const ouve = (fala: ChatMessage) => {
      atual.falas.push(fala);
      if (atual.falas.length > LIMITE_MEMORIA) {
        atual.falas.splice(0, atual.falas.length - LIMITE_MEMORIA);
      }
      atual.contadas += 1;
      setFalas([...atual.falas]);
      setRecebidas(atual.contadas);
    };

    socket.on("chat", ouve);
    return () => {
      socket.off("chat", ouve);
    };
  }, [code]);

  const enviar = useCallback((text: string) => {
    // A sala e o autor vêm da conexão no servidor; daqui vai só o texto.
    getSocket().emit("enviarChat", { text }, (res) => {
      setErro(res.ok ? null : res.error);
    });
  }, []);

  return { falas, enviar, erro, recebidas };
}

/** Hora curta da fala, que é o único contexto temporal que interessa num chat. */
function hora(em: number): string {
  return new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatSala({ code, variante, meuId }: Props) {
  const { falas, enviar, erro, recebidas } = useFalas(code);
  const [texto, setTexto] = useState("");
  // A bolha começa fechada: durante a rodada o mapa e o panorama vêm primeiro.
  const [aberto, setAberto] = useState(variante === "painel");
  // Recolhida, a bolha só conta o que chegar daqui para a frente: o que veio
  // antes (no lobby, por exemplo) a pessoa já viu.
  const [lidas, setLidas] = useState(() => (variante === "painel" ? 0 : memoriaDaSala(code).contadas));

  const raiz = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  const naoLidas = Math.max(0, recebidas - lidas);

  // Com o chat aberto as falas já estão à vista: nada fica pendente.
  useEffect(() => {
    if (aberto) setLidas(recebidas);
  }, [aberto, recebidas]);

  useEffect(() => {
    if (aberto) fim.current?.scrollIntoView({ block: "end" });
  }, [aberto, recebidas]);

  /**
   * Enquanto o campo do chat tem o foco, a tecla não deve chegar ao jogo: espaço
   * confirma o palpite e as setas giram a câmera. Barrar na fase de captura
   * funciona sem depender de onde o jogo pendurou os atalhos — e vale só para
   * teclas nascidas dentro do chat, então digitar fora daqui segue normal.
   */
  useEffect(() => {
    const barra = (event: KeyboardEvent) => {
      const alvo = event.target;
      if (alvo instanceof Node && raiz.current?.contains(alvo)) event.stopPropagation();
    };

    window.addEventListener("keydown", barra, true);
    window.addEventListener("keyup", barra, true);
    return () => {
      window.removeEventListener("keydown", barra, true);
      window.removeEventListener("keyup", barra, true);
    };
  }, []);

  function submete(event: React.FormEvent) {
    event.preventDefault();
    const limpo = texto.trim();
    if (!limpo) return;
    enviar(limpo);
    setTexto("");
  }

  const lista = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
      {falas.length === 0 ? (
        <p className="py-6 text-center text-sm text-mist-300">
          Ninguém falou ainda. Quem chega no meio começa com o chat vazio.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {falas.map((fala) => (
            <li key={fala.id} className="flex items-start gap-2">
              <Avatar avatar={fala.avatar} size={26} className="mt-0.5 shrink-0 rounded-md" />
              <div className="min-w-0">
                <p className="flex items-baseline gap-2 text-xs">
                  <span
                    className={`truncate font-semibold ${
                      fala.playerId === meuId ? "text-beam-400" : "text-mist-100"
                    }`}
                  >
                    {fala.playerName}
                  </span>
                  <span className="shrink-0 text-mist-300">{hora(fala.em)}</span>
                </p>
                <p className="text-sm break-words text-mist-100">{fala.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div ref={fim} />
    </div>
  );

  const formulario = (
    <form onSubmit={submete} className="shrink-0 border-t border-ink-700 p-2">
      {erro && <p className="px-1 pb-2 text-xs text-flare-400">{erro}</p>}
      <div className="flex gap-2">
        <input
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={CHAT_MAX_CHARS}
          placeholder="Falar com a sala…"
          aria-label="Escrever no chat da sala"
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950/70 px-3 py-2 text-sm outline-none placeholder:text-mist-300 focus:border-beam-500"
        />
        <button
          type="submit"
          disabled={!texto.trim()}
          className="shrink-0 rounded-lg bg-beam-500 px-3 py-2 text-sm font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-mist-300"
        >
          Enviar
        </button>
      </div>
    </form>
  );

  if (variante === "painel") {
    return (
      <section ref={raiz} className="panel flex h-80 flex-col rounded-2xl">
        <h2 className="shrink-0 border-b border-ink-700 px-4 py-3 text-sm font-semibold tracking-widest text-mist-300 uppercase">
          Chat da sala
        </h2>
        {lista}
        {formulario}
      </section>
    );
  }

  // Bolha: à esquerda, porque o mini-mapa e o botão de confirmar moram no canto
  // de baixo à direita. Fica depois da coluna de controles da câmera (bússola,
  // zoom) e, no celular, sobe para o alto — lá embaixo, aberta, cobriria
  // justamente o mapa e o botão de confirmar.
  return (
    <div
      ref={raiz}
      className={`pointer-events-none ${ZONA_CHAT}`}
    >
      {aberto ? (
        <section className="panel pointer-events-auto flex h-[36vh] max-h-72 flex-col rounded-2xl shadow-2xl sm:h-80 sm:w-80">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-700 px-3 py-2">
            <h2 className="text-xs font-semibold tracking-widest text-mist-300 uppercase">
              Chat da sala
            </h2>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-lg border border-ink-600 px-2.5 py-1 text-xs font-medium transition hover:border-beam-500 hover:text-beam-400"
            >
              Recolher
            </button>
          </div>
          {lista}
          {formulario}
        </section>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            // Abrir é intenção de escrever; só aqui o chat toma o teclado.
            requestAnimationFrame(() => campo.current?.focus());
          }}
          className="panel pointer-events-auto flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold shadow-2xl transition hover:text-beam-400"
        >
          Chat
          {naoLidas > 0 && (
            <span className="rounded-full bg-beam-500 px-2 py-0.5 text-xs font-bold text-ink-950">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
