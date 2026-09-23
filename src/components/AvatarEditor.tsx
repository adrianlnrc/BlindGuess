"use client";

import Link from "next/link";
import { useState } from "react";
import PersonagemGiravel from "./PersonagemGiravel";
import { GRATIS, moedas, vestir } from "./cosmeticos";
import { SKIN_TONES } from "@/lib/profile";
import { itemsOfKind, type ShopItem } from "@/lib/shop";
import type { Avatar as AvatarType } from "@/lib/types";

type Props = {
  avatar: AvatarType;
  owned: string[];
  onChange: (patch: Partial<AvatarType>) => void;
};

type Escolha = {
  /** Valor guardado no avatar (cor, id de chapéu, id de rosto). */
  value: string;
  label: string;
  /** Item pago correspondente — ausente quando a escolha é grátis. */
  item?: ShopItem;
  tenho: boolean;
};

/**
 * Provador do personagem: o boneco grande em 3D à esquerda, girável, trocando
 * de item na hora em que a opção é escolhida.
 *
 * O item bloqueado **não** fica desabilitado: escolher um veste-o só na prévia
 * — o personagem muda na tela, aparece o preço e o caminho para a loja. Nada
 * disso chega ao perfil: `onChange` só é chamado com o que a pessoa já tem, e
 * é o servidor que vende e debita. Ver o item vestido é o convite para comprar;
 * o que passa para o perfil continua sendo só o que foi pago.
 */
export default function AvatarEditor({ avatar, owned, onChange }: Props) {
  /** Item bloqueado em prova. Vive aqui e morre aqui — nunca vai para o perfil. */
  const [prova, setProva] = useState<ShopItem | null>(null);

  const tenho = (item: ShopItem) => owned.includes(item.id);
  const mostrado = prova ? vestir(avatar, prova) : avatar;

  /** Escolhas de um eixo: grátis primeiro, depois as minhas, depois as bloqueadas. */
  function escolhas(kind: ShopItem["kind"]): Escolha[] {
    const gratis: Escolha[] = GRATIS[kind].map((o) => ({ ...o, tenho: true }));
    const pagas: Escolha[] = itemsOfKind(kind).map((item) => ({
      value: item.value,
      label: item.label,
      item,
      tenho: tenho(item),
    }));
    return [...gratis, ...pagas.filter((e) => e.tenho), ...pagas.filter((e) => !e.tenho)];
  }

  /** Escolher: o que é meu veste de verdade; o que é bloqueado só entra na prévia. */
  function escolher(kind: ShopItem["kind"], escolha: Escolha) {
    if (escolha.item && !escolha.tenho) {
      setProva(escolha.item);
      return;
    }
    setProva(null);
    if (kind === "hat") onChange({ hat: escolha.value as AvatarType["hat"] });
    else if (kind === "face") onChange({ face: escolha.value as AvatarType["face"] });
    else if (kind === "outfit") onChange({ outfit: escolha.value });
    else onChange({ accent: escolha.value });
  }

  function selecionado(kind: ShopItem["kind"], value: string): boolean {
    if (prova) return prova.kind === kind && prova.value === value;
    if (kind === "hat") return avatar.hat === value;
    if (kind === "face") return avatar.face === value;
    if (kind === "outfit") return avatar.outfit === value;
    return avatar.accent === value;
  }

  const bloqueados = (["hat", "face", "outfit", "accent"] as const).reduce(
    (total, kind) => total + itemsOfKind(kind).filter((i) => !tenho(i)).length,
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_1fr]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <PersonagemGiravel avatar={mostrado} altura={300} tamanhoReserva={200}>
          {prova && (
            <span className="pointer-events-none absolute top-3 left-3 rounded-lg border border-flare-400/50 bg-ink-950/85 px-2.5 py-1 text-xs font-semibold tracking-wide text-flare-400 uppercase">
              prévia
            </span>
          )}
        </PersonagemGiravel>

        <span className="text-center text-xs text-mist-300">seu personagem</span>

        {prova ? (
          <div className="rounded-2xl border border-flare-400/40 bg-flare-400/10 p-3">
            <p className="font-semibold text-mist-100">
              {prova.label}{" "}
              <span className="text-mist-300">— ainda não é seu</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-flare-400">
              <span aria-hidden>🪙</span>
              <span className="num">{moedas(prova.price)}</span>
              <span className="text-mist-300">na loja</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/loja?item=${prova.id}`}
                className="inline-flex min-h-11 items-center rounded-xl bg-flare-400 px-4 font-semibold text-ink-950 transition hover:brightness-110"
              >
                Comprar na loja
              </Link>
              <button
                type="button"
                onClick={() => setProva(null)}
                className="inline-flex min-h-11 items-center rounded-xl border border-ink-600 px-4 font-medium text-mist-300 transition hover:border-beam-500 hover:text-beam-400"
              >
                Tirar a prévia
              </button>
            </div>
          </div>
        ) : (
          <p className="text-center text-xs text-mist-300">
            {bloqueados > 0 ? (
              <>
                {bloqueados} itens da loja dão para provar aqui antes de comprar.
              </>
            ) : (
              <>Você já tem tudo o que a loja vende.</>
            )}
          </p>
        )}
      </div>

      <div className="space-y-5">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist-300">
          <span>
            <span className="text-beam-400">●</span> grátis ou seu
          </span>
          <span>
            <span aria-hidden>🪙</span> da loja — toque para provar no personagem
          </span>
        </p>

        <Cores
          label="Pele"
          escolhas={SKIN_TONES.map((cor) => ({ value: cor, label: cor, tenho: true }))}
          estaSelecionado={(cor) => !prova && avatar.skin === cor}
          onPick={(cor) => {
            setProva(null);
            onChange({ skin: cor });
          }}
        />

        <Cores
          label="Roupa"
          escolhas={escolhas("outfit")}
          estaSelecionado={(cor) => selecionado("outfit", cor)}
          onPick={(_cor, escolha) => escolher("outfit", escolha)}
        />

        <Cores
          label="Detalhe"
          escolhas={escolhas("accent")}
          estaSelecionado={(cor) => selecionado("accent", cor)}
          onPick={(_cor, escolha) => escolher("accent", escolha)}
        />

        <Fichas
          label="Chapéu"
          escolhas={escolhas("hat")}
          estaSelecionado={(v) => selecionado("hat", v)}
          onPick={(escolha) => escolher("hat", escolha)}
        />

        <Fichas
          label="Rosto"
          escolhas={escolhas("face")}
          estaSelecionado={(v) => selecionado("face", v)}
          onPick={(escolha) => escolher("face", escolha)}
        />

        <Link
          href="/loja"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-beam-400 hover:underline"
        >
          Ver a loja →
        </Link>
      </div>
    </div>
  );
}

/** Amostras de cor. Bloqueada não fica desabilitada: leva para a prévia. */
function Cores({
  label,
  escolhas,
  estaSelecionado,
  onPick,
}: {
  label: string;
  escolhas: Escolha[];
  estaSelecionado: (value: string) => boolean;
  onPick: (value: string, escolha: Escolha) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {escolhas.map((escolha) => {
          const bloqueado = !escolha.tenho;
          const ativo = estaSelecionado(escolha.value);
          return (
            <button
              key={escolha.value}
              type="button"
              aria-label={
                bloqueado
                  ? `${label}: ${escolha.label} — ${escolha.item?.price} moedas, toque para provar`
                  : `${label}: ${escolha.label}`
              }
              aria-pressed={ativo}
              onClick={() => onPick(escolha.value, escolha)}
              className={`relative grid size-11 place-content-center rounded-xl border-2 transition ${
                ativo ? "border-beam-400" : "border-ink-700 hover:border-ink-500"
              }`}
            >
              <span
                aria-hidden
                style={{ background: escolha.value }}
                className={`block size-7 rounded-lg ${bloqueado ? "opacity-70" : ""}`}
              />
              {bloqueado && (
                <span
                  aria-hidden
                  className="absolute -right-1 -bottom-1 rounded-md bg-ink-950 px-1 text-[0.6rem] leading-4 text-flare-400"
                >
                  🪙
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Fichas de chapéu e rosto, com preço à mostra em vez de cadeado. */
function Fichas({
  label,
  escolhas,
  estaSelecionado,
  onPick,
}: {
  label: string;
  escolhas: Escolha[];
  estaSelecionado: (value: string) => boolean;
  onPick: (escolha: Escolha) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {escolhas.map((escolha) => {
          const bloqueado = !escolha.tenho;
          const ativo = estaSelecionado(escolha.value);
          return (
            <button
              key={escolha.value}
              type="button"
              aria-pressed={ativo}
              aria-label={
                bloqueado
                  ? `${escolha.label} — ${escolha.item?.price} moedas, toque para provar`
                  : escolha.label
              }
              onClick={() => onPick(escolha)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm transition ${
                ativo
                  ? "border-beam-500 bg-beam-500/10 text-beam-400"
                  : bloqueado
                    ? "border-flare-400/40 text-mist-100 hover:border-flare-400"
                    : "border-ink-600 text-mist-300 hover:border-ink-500"
              }`}
            >
              <span>{escolha.label}</span>
              {bloqueado && escolha.item && (
                <span className="flex items-center gap-0.5 text-xs text-flare-400">
                  <span aria-hidden>🪙</span>
                  <span className="num">{moedas(escolha.item.price)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
