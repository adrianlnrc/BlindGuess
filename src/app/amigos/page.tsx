"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { loadProfile } from "@/lib/profile";
import { getSocket } from "@/lib/socket";
import type { Friend, PlayerProfile } from "@/lib/types";

export default function FriendsPage() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setProfile(loadProfile()), []);

  const refresh = useCallback(() => {
    getSocket().emit("fetchFriends", (res) => {
      if (res.ok) {
        setMyCode(res.myCode);
        setFriends(res.friends);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }, []);

  /**
   * O servidor só liga esta conexão ao perfil depois do `identify`, então quem
   * abre a página de amigos direto precisa se identificar antes de pedir a
   * lista — e de novo a cada reconexão.
   */
  const identifyAndRefresh = useCallback(() => {
    const current = loadProfile();
    if (!current.id) return;

    getSocket().emit("identify", { profile: current }, () => refresh());
  }, [refresh]);

  useEffect(() => {
    if (!profile?.id) return;

    const socket = getSocket();
    identifyAndRefresh();
    socket.on("connect", identifyAndRefresh);
    // A presença muda sem aviso, então recarregamos de tempos em tempos.
    const id = setInterval(refresh, 20_000);

    return () => {
      socket.off("connect", identifyAndRefresh);
      clearInterval(id);
    };
  }, [profile?.id, refresh, identifyAndRefresh]);

  function add(event: React.FormEvent) {
    event.preventDefault();
    const wanted = code.trim().toUpperCase();
    if (!profile || wanted.length < 4 || busy) return;

    setBusy(true);
    setMessage(null);

    getSocket().emit("addFriend", { code: wanted }, (res) => {
      setBusy(false);
      if (res.ok) {
        setFriends(res.friends);
        setCode("");
        setMessage("Amigo adicionado.");
      } else {
        setMessage(res.error);
      }
    });
  }

  function remove(friend: Friend) {
    if (!profile) return;

    getSocket().emit("removeFriend", { friendId: friend.profileId }, (res) => {
      if (res.ok) setFriends(res.friends);
      else setMessage(res.error);
    });
  }

  async function copyCode() {
    if (!myCode) return;
    await navigator.clipboard.writeText(myCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const onlineCount = friends.filter((f) => f.online).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Amigos</h1>
          <p className="text-mist-300">
            {friends.length === 0
              ? "Troque códigos para ver quem está jogando."
              : `${onlineCount} de ${friends.length} ${friends.length === 1 ? "amigo" : "amigos"} online agora.`}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
        >
          ← Voltar
        </Link>
      </header>

      {error && (
        <p className="rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-3 text-flare-400">
          {error}
        </p>
      )}

      <section className="panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6">
        <div>
          <p className="text-xs tracking-widest text-mist-300 uppercase">Seu código</p>
          <p className="num text-3xl tracking-[0.28em] text-beam-400">{myCode ?? "·····"}</p>
        </div>
        <button
          type="button"
          onClick={copyCode}
          disabled={!myCode}
          className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400 disabled:opacity-40"
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </section>

      <form onSubmit={add} className="panel flex flex-wrap items-end gap-4 rounded-2xl p-6">
        <div className="flex-1">
          <label htmlFor="friend-code" className="text-xs tracking-widest text-mist-300 uppercase">
            Adicionar pelo código
          </label>
          <input
            id="friend-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="AB12CD"
            maxLength={6}
            className="mt-1 w-full rounded-xl border border-ink-600 bg-ink-950/70 px-4 py-2.5 text-center text-xl font-bold tracking-[0.3em] uppercase outline-none focus:border-beam-500"
          />
        </div>
        <button
          type="submit"
          disabled={code.trim().length < 4 || busy}
          className="rounded-xl bg-beam-500 px-6 py-2.5 font-semibold text-ink-950 transition hover:bg-beam-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Adicionar
        </button>
      </form>

      {message && <p className="text-center text-mist-300">{message}</p>}

      <section className="flex flex-col gap-2">
        {friends.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-600 px-6 py-8 text-center text-mist-300">
            Nenhum amigo ainda. Mande seu código para a galera.
          </p>
        ) : (
          friends.map((friend) => (
            <div
              key={friend.profileId}
              className="panel flex items-center gap-3 rounded-2xl px-4 py-3"
            >
              <div className="relative shrink-0">
                <Avatar avatar={friend.avatar} size={44} className="rounded-xl" />
                <span
                  title={friend.online ? "online" : "offline"}
                  className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink-900 ${
                    friend.online ? "bg-beam-400" : "bg-ink-600"
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{friend.name}</p>
                <p className="text-sm text-mist-300">
                  nível {friend.level}
                  {friend.streak > 0 && ` · 🔥 ${friend.streak}`}
                  {friend.online ? " · jogando agora" : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={() => remove(friend)}
                className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-mist-300 transition hover:border-rose-signal hover:text-rose-signal"
              >
                Remover
              </button>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
