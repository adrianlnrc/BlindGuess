"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { loadProfile, saveProfileLocal } from "@/lib/profile";
import { itemsOfKind, type ShopItem } from "@/lib/shop";
import { getSocket } from "@/lib/socket";
import type { Avatar as AvatarType, PlayerProfile } from "@/lib/types";

const SECTIONS: { kind: ShopItem["kind"]; title: string }[] = [
  { kind: "hat", title: "Chapéus" },
  { kind: "face", title: "Rostos" },
  { kind: "outfit", title: "Roupas" },
  { kind: "accent", title: "Detalhes" },
];

export default function ShopPage() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [wallet, setWallet] = useState<{ coins: number; items: string[] }>({ coins: 0, items: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setProfile(loadProfile()), []);

  useEffect(() => {
    if (!profile?.id) return;

    const socket = getSocket();
    const fetchWallet = () =>
      socket.emit("fetchWallet", { profileId: profile.id }, (res) => setWallet(res));

    fetchWallet();
    socket.on("connect", fetchWallet);
    return () => {
      socket.off("connect", fetchWallet);
    };
  }, [profile?.id]);

  if (!profile) {
    return (
      <main className="grid min-h-dvh place-content-center">
        <p className="text-mist-300">Carregando…</p>
      </main>
    );
  }

  /** Mostra como o personagem fica com o item, sem equipar de verdade. */
  function preview(item: ShopItem): AvatarType {
    if (!profile) return { skin: "", outfit: "", accent: "", hat: "none", face: "smile" };
    const avatar = { ...profile.avatar };
    if (item.kind === "hat") avatar.hat = item.value as AvatarType["hat"];
    else if (item.kind === "face") avatar.face = item.value as AvatarType["face"];
    else if (item.kind === "outfit") avatar.outfit = item.value;
    else avatar.accent = item.value;
    return avatar;
  }

  function equip(item: ShopItem) {
    setProfile((current) => {
      if (!current) return current;
      const next = { ...current, avatar: preview(item) };
      saveProfileLocal(next);
      return next;
    });
    setMessage(`${item.label} equipado.`);
  }

  function buy(item: ShopItem) {
    if (!profile || busy) return;

    setBusy(item.id);
    setMessage(null);

    getSocket().emit("buyItem", { profileId: profile.id, itemId: item.id }, (res) => {
      setBusy(null);
      if (res.ok) {
        setWallet({ coins: res.coins, items: res.items });
        equip(item);
      } else {
        setMessage(res.error);
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Loja</h1>
          <p className="text-mist-300">
            Moedas caem a cada partida: uma por mil pontos, com bônus no desafio do dia e na
            vitória em duelo.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-2.5 text-lg font-bold text-flare-400">
            <span aria-hidden>🪙</span>
            <span className="num">{wallet.coins.toLocaleString("pt-BR")}</span>
          </span>
          <Link
            href="/"
            className="rounded-xl border border-ink-600 px-4 py-2.5 font-medium transition hover:border-beam-500 hover:text-beam-400"
          >
            ← Voltar
          </Link>
        </div>
      </header>

      {message && (
        <p className="rounded-xl border border-ink-600 bg-ink-900/60 px-4 py-3 text-mist-100">
          {message}
        </p>
      )}

      {SECTIONS.map((section) => (
        <section key={section.kind} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
            {section.title}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itemsOfKind(section.kind).map((item) => {
              const owned = wallet.items.includes(item.id);
              const affordable = wallet.coins >= item.price;

              return (
                <div key={item.id} className="panel flex items-center gap-4 rounded-2xl p-4">
                  <Avatar avatar={preview(item)} size={56} className="rounded-xl" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.label}</p>
                    {owned ? (
                      <p className="text-sm text-beam-400">no seu guarda-roupa</p>
                    ) : (
                      <p className="flex items-center gap-1 text-sm text-flare-400">
                        <span aria-hidden>🪙</span>
                        <span className="num">{item.price.toLocaleString("pt-BR")}</span>
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => (owned ? equip(item) : buy(item))}
                    disabled={busy === item.id || (!owned && !affordable)}
                    className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      owned
                        ? "border border-ink-600 hover:border-beam-500 hover:text-beam-400"
                        : "bg-flare-400 text-ink-950 hover:brightness-110"
                    }`}
                  >
                    {busy === item.id ? "…" : owned ? "Usar" : affordable ? "Comprar" : "Falta moeda"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
