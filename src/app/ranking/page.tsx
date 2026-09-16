"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { mapLabel } from "@/lib/catalog";
import { getSocket } from "@/lib/socket";
import type { Leaderboards } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function RankingPage() {
  const [boards, setBoards] = useState<Leaderboards | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const fetch = () => socket.emit("fetchLeaderboards", (res) => setBoards(res.leaderboards));

    fetch();
    socket.on("connect", fetch);
    return () => {
      socket.off("connect", fetch);
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Ranking</h1>
          <p className="text-mist-300">Melhores partidas solo e as ofensivas mais longas.</p>
        </div>
        <Link
          href="/"
          className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
        >
          ← Voltar
        </Link>
      </header>

      {!boards ? (
        <p className="text-mist-300">Carregando…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="panel rounded-2xl p-6">
            <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
              Melhores partidas solo
            </h2>

            {boards.solo.length === 0 ? (
              <p className="mt-4 text-mist-300">
                Ninguém jogou solo ainda. Seja o primeiro do quadro.
              </p>
            ) : (
              <ol className="mt-4 space-y-2">
                {boards.solo.map((entry, index) => (
                  <li
                    key={`${entry.profileId}-${entry.playedAt}`}
                    className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-950/40 px-3 py-2.5"
                  >
                    <span className="w-7 text-center text-lg">{MEDALS[index] ?? index + 1}</span>
                    <Avatar avatar={entry.avatar} size={36} className="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.name}</p>
                      <p className="text-xs text-mist-300">
                        {entry.rounds} rodadas · {mapLabel(entry.region)}
                      </p>
                    </div>
                    <span className="font-bold num text-beam-400">
                      {entry.score.toLocaleString("pt-BR")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel rounded-2xl p-6">
            <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
              Ofensivas diárias
            </h2>

            {boards.streaks.length === 0 ? (
              <p className="mt-4 text-mist-300">Nenhuma ofensiva começou ainda.</p>
            ) : (
              <ol className="mt-4 space-y-2">
                {boards.streaks.map((entry, index) => (
                  <li
                    key={entry.profileId}
                    className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-950/40 px-3 py-2.5"
                  >
                    <span className="w-7 text-center text-lg">{MEDALS[index] ?? index + 1}</span>
                    <Avatar avatar={entry.avatar} size={36} className="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.name}</p>
                      <p className="text-xs text-mist-300">recorde: {entry.longest} dias</p>
                    </div>
                    <span className="font-bold num text-flare-400">
                      🔥 {entry.current}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
