"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSocket, rememberName, rememberPlayer, storedName } from "@/lib/socket";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(storedName()), []);

  const nickname = name.trim();

  function enterRoom(roomCode: string, playerId: string) {
    rememberName(nickname);
    rememberPlayer(roomCode, playerId);
    router.push(`/room/${roomCode}`);
  }

  function handleCreate() {
    if (!nickname || busy) return;
    setBusy(true);
    setError(null);
    rememberName(nickname);

    getSocket().emit("createRoom", { name: nickname }, (res) => {
      setBusy(false);
      if (res.ok) enterRoom(res.code, res.playerId);
      else setError(res.error);
    });
  }

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (!nickname || roomCode.length < 4 || busy) return;

    setBusy(true);
    setError(null);
    rememberName(nickname);

    getSocket().emit("joinRoom", { code: roomCode, name: nickname }, (res) => {
      setBusy(false);
      if (res.ok) enterRoom(res.code, res.playerId);
      else setError(res.error);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-12 px-6 py-16">
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-900/60 px-3 py-1 text-xs font-medium tracking-widest text-beam-400 uppercase">
          <span className="size-1.5 rounded-full bg-beam-400" />
          multiplayer em tempo real
        </span>
        <h1 className="text-5xl font-black tracking-tight sm:text-7xl">
          Blind<span className="text-beam-400">Guess</span>
        </h1>
        <p className="max-w-xl text-lg text-mist-300">
          Você cai num ponto aleatório do planeta sem saber onde está. Olhe as placas, a vegetação,
          o lado da pista — e crave o palpite no mapa antes do tempo acabar.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="panel rounded-2xl p-6">
          <label htmlFor="nickname" className="text-sm font-medium text-mist-300">
            Seu apelido
          </label>
          <input
            id="nickname"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 18))}
            placeholder="ex: adrian"
            maxLength={18}
            className="mt-2 w-full rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-3 text-lg outline-none focus:border-beam-500"
          />

          <button
            type="button"
            onClick={handleCreate}
            disabled={!nickname || busy}
            className="mt-4 w-full rounded-xl bg-beam-500 px-4 py-3 text-lg font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Criar sala
          </button>
          <p className="mt-2 text-sm text-mist-300">
            Você vira o anfitrião e recebe um código para chamar a galera.
          </p>
        </div>

        <form onSubmit={handleJoin} className="panel rounded-2xl p-6">
          <label htmlFor="code" className="text-sm font-medium text-mist-300">
            Código da sala
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="ABC12"
            maxLength={5}
            className="mt-2 w-full rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] uppercase outline-none focus:border-beam-500"
          />

          <button
            type="submit"
            disabled={!nickname || code.trim().length < 4 || busy}
            className="mt-4 w-full rounded-xl border border-ink-600 px-4 py-3 text-lg font-semibold transition hover:border-beam-500 hover:text-beam-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Entrar na sala
          </button>
          <p className="mt-2 text-sm text-mist-300">
            Precisa do apelido preenchido ao lado para entrar.
          </p>
        </form>
      </section>

      {error && (
        <p className="rounded-xl border border-rose-signal/40 bg-rose-signal/10 px-4 py-3 text-rose-signal">
          {error}
        </p>
      )}

      <footer className="text-sm text-mist-300">
        Como funciona: cada rodada vale até <strong className="text-mist-100">5.000 pontos</strong>.
        Quanto mais perto do local real, maior a pontuação — e a distância é medida em linha reta.
      </footer>
    </main>
  );
}
