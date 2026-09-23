"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import PersonagemGiravel from "@/components/PersonagemGiravel";
import { NOME_DA_SECAO, faltam, moedas, vestir } from "@/components/cosmeticos";
import { loadProfile, saveProfileLocal } from "@/lib/profile";
import { itemById, itemsOfKind, SHOP_ITEMS, type ShopItem } from "@/lib/shop";
import { getSocket } from "@/lib/socket";
import type { Avatar as AvatarType, PlayerProfile } from "@/lib/types";

const SECTIONS: ShopItem["kind"][] = ["hat", "face", "outfit", "accent"];

/** Como as moedas entram — o texto que transforma "falta moeda" em plano. */
const COMO_GANHAR =
  "Moedas caem a cada partida: uma por mil pontos, com bônus no desafio do dia e na vitória em duelo.";

export default function ShopPage() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [wallet, setWallet] = useState<{ coins: number; items: string[] }>({ coins: 0, items: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Item no provador. Só visual: vestir de verdade continua passando pela compra. */
  const [provando, setProvando] = useState<ShopItem | null>(null);

  useEffect(() => setProfile(loadProfile()), []);

  /**
   * Chegou da customização com `?item=`: já abre a loja com o item no provador,
   * para a pessoa ver de novo o que a fez vir até aqui.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("item");
    const item = id ? itemById(id) : undefined;
    if (item) setProvando(item);
  }, []);

  /**
   * A identidade mora na conexão: o servidor só sabe de quem é a carteira
   * depois do `identify`. Quem abre a loja direto também precisa se
   * identificar, e de novo a cada reconexão.
   */
  useEffect(() => {
    if (!profile?.id) return;

    const socket = getSocket();
    const identifyAndFetch = () => {
      socket.emit("identify", { profile }, () => {
        socket.emit("fetchWallet", (res) => setWallet(res));
      });
    };

    identifyAndFetch();
    socket.on("connect", identifyAndFetch);
    return () => {
      socket.off("connect", identifyAndFetch);
    };
  }, [profile?.id]);

  /** Item mais barato que ainda falta — a meta concreta de quem está sem moeda. */
  const maisBarato = useMemo(() => {
    const restantes = SHOP_ITEMS.filter((item) => !wallet.items.includes(item.id));
    return restantes.reduce<ShopItem | null>(
      (menor, item) => (!menor || item.price < menor.price ? item : menor),
      null,
    );
  }, [wallet.items]);

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
    return vestir(profile.avatar, item);
  }

  function equip(item: ShopItem) {
    setProfile((current) => {
      if (!current) return current;
      const next = { ...current, avatar: vestir(current.avatar, item) };
      saveProfileLocal(next);
      return next;
    });
    setMessage(`${item.label} equipado.`);
  }

  function buy(item: ShopItem) {
    if (!profile || busy) return;

    setBusy(item.id);
    setMessage(null);

    getSocket().emit("buyItem", { itemId: item.id }, (res) => {
      setBusy(null);
      if (res.ok) {
        setWallet({ coins: res.coins, items: res.items });
        equip(item);
      } else {
        setMessage(res.error);
      }
    });
  }

  const noProvador = provando ? preview(provando) : profile.avatar;
  const tenhoProvado = provando ? wallet.items.includes(provando.id) : false;
  const faltaProvado = provando ? faltam(provando.price, wallet.coins) : 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Loja</h1>
          <p className="text-mist-300">{COMO_GANHAR}</p>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-xl border border-flare-400/40 bg-flare-400/10 px-4 py-2.5 text-lg font-bold text-flare-400">
            <span aria-hidden>🪙</span>
            <span className="num">{moedas(wallet.coins)}</span>
          </span>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-xl border border-ink-600 px-4 font-medium transition hover:border-beam-500 hover:text-beam-400"
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

      {/* Provador: a compra como decisão visual — o item no seu personagem, antes de gastar. */}
      <section className="panel grid gap-5 rounded-2xl p-5 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-center">
        <PersonagemGiravel avatar={noProvador} altura={280} tamanhoReserva={190}>
          {provando && !tenhoProvado && (
            <span className="pointer-events-none absolute top-3 left-3 rounded-lg border border-flare-400/50 bg-ink-950/85 px-2.5 py-1 text-xs font-semibold tracking-wide text-flare-400 uppercase">
              prévia
            </span>
          )}
        </PersonagemGiravel>

        <div>
          <p className="text-xs tracking-widest text-mist-300 uppercase">Provador</p>

          {provando ? (
            <>
              <h2 className="mt-1 text-2xl font-bold">{provando.label}</h2>
              <p className="text-sm text-mist-300">{NOME_DA_SECAO[provando.kind]}</p>

              {tenhoProvado ? (
                <p className="mt-3 text-beam-400">Já é seu — pode vestir quando quiser.</p>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-lg font-bold text-flare-400">
                  <span aria-hidden>🪙</span>
                  <span className="num">{moedas(provando.price)}</span>
                </p>
              )}

              {!tenhoProvado && faltaProvado > 0 && (
                <p className="mt-1 text-sm text-mist-300">
                  Faltam{" "}
                  <span className="num font-semibold text-mist-100">{moedas(faltaProvado)}</span>{" "}
                  moedas. Cada mil pontos numa partida viram uma moeda, e o desafio do dia e a
                  vitória em duelo pagam bônus.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {tenhoProvado ? (
                  <button
                    type="button"
                    onClick={() => equip(provando)}
                    className="inline-flex min-h-11 items-center rounded-xl border border-ink-600 px-4 font-semibold transition hover:border-beam-500 hover:text-beam-400"
                  >
                    Vestir
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => buy(provando)}
                    disabled={busy === provando.id || faltaProvado > 0}
                    className="inline-flex min-h-11 items-center rounded-xl bg-flare-400 px-4 font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === provando.id ? "…" : faltaProvado > 0 ? "Falta moeda" : "Comprar"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setProvando(null)}
                  className="inline-flex min-h-11 items-center rounded-xl border border-ink-600 px-4 font-medium text-mist-300 transition hover:border-beam-500 hover:text-beam-400"
                >
                  Tirar a prévia
                </button>
                {faltaProvado > 0 && !tenhoProvado && (
                  <Link
                    href="/"
                    className="inline-flex min-h-11 items-center rounded-xl border border-beam-500/60 px-4 font-semibold text-beam-400 transition hover:bg-beam-500/10"
                  >
                    Jogar para ganhar moedas
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-1 text-2xl font-bold">Prove antes de gastar</h2>
              <p className="mt-2 text-mist-300">
                Toque em qualquer item abaixo para vê-lo no seu personagem. Arraste o boneco para
                girar e olhar de todos os lados.
              </p>
              {maisBarato && (
                <p className="mt-3 text-sm text-mist-300">
                  Mais barato que ainda falta:{" "}
                  <button
                    type="button"
                    onClick={() => setProvando(maisBarato)}
                    className="font-semibold text-beam-400 hover:underline"
                  >
                    {maisBarato.label}
                  </button>{" "}
                  por <span className="num text-flare-400">🪙 {moedas(maisBarato.price)}</span>
                  {faltam(maisBarato.price, wallet.coins) > 0 && (
                    <>
                      {" "}
                      — faltam{" "}
                      <span className="num font-semibold text-mist-100">
                        {moedas(faltam(maisBarato.price, wallet.coins))}
                      </span>
                    </>
                  )}
                  .
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {SECTIONS.map((kind) => (
        <section key={kind} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-widest text-mist-300 uppercase">
            {NOME_DA_SECAO[kind]}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itemsOfKind(kind).map((item) => {
              const owned = wallet.items.includes(item.id);
              const falta = faltam(item.price, wallet.coins);
              const emProva = provando?.id === item.id;

              return (
                <div
                  key={item.id}
                  className={`panel flex flex-col gap-3 rounded-2xl p-4 transition ${
                    emProva ? "border-flare-400/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setProvando(item)}
                      aria-label={`Provar ${item.label} no personagem`}
                      className={`shrink-0 rounded-xl border-2 p-0.5 transition ${
                        emProva ? "border-flare-400" : "border-transparent hover:border-ink-500"
                      }`}
                    >
                      <Avatar avatar={preview(item)} size={56} className="rounded-xl" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{item.label}</p>
                      {owned ? (
                        <p className="text-sm text-beam-400">no seu guarda-roupa</p>
                      ) : (
                        <>
                          <p className="flex items-center gap-1 text-sm text-flare-400">
                            <span aria-hidden>🪙</span>
                            <span className="num">{moedas(item.price)}</span>
                          </p>
                          {falta > 0 && (
                            <p className="text-xs text-mist-300">
                              faltam <span className="num">{moedas(falta)}</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProvando(item)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-ink-600 px-3 text-sm font-medium text-mist-100 transition hover:border-beam-500 hover:text-beam-400"
                    >
                      {emProva ? "No provador" : "Provar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => (owned ? equip(item) : buy(item))}
                      disabled={busy === item.id || (!owned && falta > 0)}
                      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        owned
                          ? "border border-ink-600 hover:border-beam-500 hover:text-beam-400"
                          : "bg-flare-400 text-ink-950 hover:brightness-110"
                      }`}
                    >
                      {busy === item.id ? "…" : owned ? "Usar" : falta === 0 ? "Comprar" : "Falta moeda"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-sm text-mist-300">
        Sem moedas suficientes? {COMO_GANHAR}{" "}
        <Link href="/" className="font-semibold text-beam-400 hover:underline">
          Jogar agora →
        </Link>
      </p>
    </main>
  );
}
