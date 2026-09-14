"use client";

import { useState } from "react";
import Avatar from "./Avatar";
import type { GameMode, Player, RegionId, RoomSettings } from "@/lib/types";

type Props = {
  code: string;
  mode: GameMode;
  challenge: { code: string; creatorName: string } | null;
  players: Player[];
  settings: RoomSettings;
  isHost: boolean;
  error?: string;
  onUpdateSettings: (patch: Partial<RoomSettings>) => void;
  onStart: () => void;
};

const REGIONS: { id: RegionId; label: string; hint: string }[] = [
  { id: "world", label: "Mundo todo", hint: "qualquer canto do planeta" },
  { id: "brazil", label: "Brasil", hint: "só território brasileiro" },
  { id: "europe", label: "Europa", hint: "capitais e estradas europeias" },
  { id: "americas", label: "Américas", hint: "do Alasca à Patagônia" },
  { id: "asia", label: "Ásia", hint: "do Oriente Médio ao Japão" },
  { id: "famous", label: "Pontos famosos", hint: "lugares icônicos, modo fácil" },
];

const TIME_OPTIONS = [
  { value: 30, label: "30s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 300, label: "5 min" },
  { value: 0, label: "sem limite" },
];

export default function Lobby({
  code,
  mode,
  challenge,
  players,
  settings,
  isHost,
  error,
  onUpdateSettings,
  onStart,
}: Props) {
  const [copied, setCopied] = useState(false);
  // Num desafio os locais ja estao fixos, entao ninguem muda a configuracao.
  const locked = !isHost || !!challenge;

  async function copyInvite() {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-widest text-mist-300 uppercase">
            {mode === "solo" ? "Partida solo" : mode === "challenge" ? "Desafio" : "Sala"}
          </p>
          {mode === "party" ? (
            <h1 className="text-5xl font-black tracking-[0.3em] text-beam-400">{code}</h1>
          ) : (
            <h1 className="text-4xl font-black">
              {mode === "solo" ? "Só você contra o mapa" : `Desafio de ${challenge?.creatorName}`}
            </h1>
          )}
        </div>

        {mode === "party" && (
          <button
            type="button"
            onClick={copyInvite}
            className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
          >
            {copied ? "Link copiado!" : "Copiar convite"}
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-flare-400">
          {error}
        </p>
      )}

      {mode === "party" && (
        <section className="panel rounded-2xl p-6">
          <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
            Jogadores ({players.length})
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {players.map((player) => (
              <li
                key={player.id}
                className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-950/50 px-4 py-3"
              >
                <Avatar avatar={player.avatar} size={36} className="rounded-lg" />
                <span className="flex-1 truncate font-medium">{player.name}</span>
                {player.isHost && (
                  <span className="rounded-full bg-flare-400/15 px-2 py-0.5 text-xs text-flare-400">
                    anfitrião
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel space-y-6 rounded-2xl p-6">
        <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
          Configuração{" "}
          {locked && (
            <span className="normal-case">
              {mode === "challenge"
                ? "(travada: os locais do desafio já foram sorteados)"
                : "(só o anfitrião muda)"}
            </span>
          )}
        </h2>

        <div>
          <p className="mb-2 text-sm text-mist-300">Região</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {REGIONS.map((region) => (
              <button
                key={region.id}
                type="button"
                disabled={locked}
                onClick={() => onUpdateSettings({ region: region.id })}
                className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
                  settings.region === region.id
                    ? "border-beam-500 bg-beam-500/10 text-beam-400"
                    : "border-ink-600 hover:border-ink-500"
                }`}
              >
                <span className="block font-medium">{region.label}</span>
                <span className="block text-xs text-mist-300">{region.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="rounds" className="text-sm text-mist-300">
              Rodadas: <strong className="text-mist-100">{settings.rounds}</strong>
            </label>
            <input
              id="rounds"
              type="range"
              min={1}
              max={20}
              value={settings.rounds}
              disabled={locked}
              onChange={(e) => onUpdateSettings({ rounds: Number(e.target.value) })}
              className="mt-3 w-full accent-beam-500"
            />
          </div>

          <div>
            <p className="text-sm text-mist-300">Tempo por rodada</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={locked}
                  onClick={() => onUpdateSettings({ roundSeconds: option.value })}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed ${
                    settings.roundSeconds === option.value
                      ? "border-beam-500 bg-beam-500/10 text-beam-400"
                      : "border-ink-600 hover:border-ink-500"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {(
            [
              ["allowMove", "Pode andar"],
              ["allowPan", "Pode girar a câmera"],
              ["allowZoom", "Pode dar zoom"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${
                settings[key] ? "border-beam-500/50 text-beam-400" : "border-ink-600 text-mist-300"
              } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={settings[key]}
                disabled={locked}
                onChange={(e) => onUpdateSettings({ [key]: e.target.checked })}
                className="size-4 accent-beam-500"
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {isHost ? (
        <button
          type="button"
          onClick={onStart}
          className="rounded-2xl bg-beam-500 px-6 py-4 text-xl font-bold text-ink-950 transition hover:bg-beam-400"
        >
          {mode === "solo" ? "Começar" : mode === "challenge" ? "Jogar o desafio" : "Começar partida"}
        </button>
      ) : (
        <p className="rounded-2xl border border-ink-600 px-6 py-4 text-center text-mist-300">
          Esperando o anfitrião começar…
        </p>
      )}
    </main>
  );
}
