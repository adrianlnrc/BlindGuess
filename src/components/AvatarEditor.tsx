"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { ACCENT_COLORS, OUTFIT_COLORS, SKIN_TONES } from "@/lib/profile";
import { itemsOfKind, paidItemFor } from "@/lib/shop";
import type { Avatar as AvatarType, FaceId, HatId } from "@/lib/types";

type Props = {
  avatar: AvatarType;
  owned: string[];
  onChange: (patch: Partial<AvatarType>) => void;
};

const HATS: { id: HatId; label: string }[] = [
  { id: "none", label: "Sem chapéu" },
  { id: "cap", label: "Boné" },
  { id: "explorer", label: "Explorador" },
  { id: "beanie", label: "Gorro" },
  { id: "headphones", label: "Fone" },
];

const FACES: { id: FaceId; label: string }[] = [
  { id: "smile", label: "Sorriso" },
  { id: "focused", label: "Concentrado" },
  { id: "glasses", label: "Óculos" },
  { id: "shades", label: "Escuros" },
];

export default function AvatarEditor({ avatar, owned, onChange }: Props) {
  const has = (kind: "hat" | "face" | "outfit" | "accent", value: string) => {
    const item = paidItemFor(kind, value);
    return !item || owned.includes(item.id);
  };

  const paidHats = itemsOfKind("hat").map((item) => ({
    id: item.value as HatId,
    label: item.label,
    locked: !owned.includes(item.id),
    price: item.price,
  }));

  const paidFaces = itemsOfKind("face").map((item) => ({
    id: item.value as FaceId,
    label: item.label,
    locked: !owned.includes(item.id),
    price: item.price,
  }));

  const paidOutfits = itemsOfKind("outfit").map((item) => item.value);
  const paidAccents = itemsOfKind("accent").map((item) => item.value);

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex flex-col items-center gap-2">
        <Avatar avatar={avatar} size={104} className="rounded-2xl" />
        <span className="text-xs text-mist-300">seu personagem</span>
      </div>

      <div className="flex-1 space-y-4">
        <Swatches
          label="Pele"
          colors={SKIN_TONES}
          selected={avatar.skin}
          onPick={(skin) => onChange({ skin })}
        />
        <Swatches
          label="Roupa"
          colors={[...OUTFIT_COLORS, ...paidOutfits]}
          selected={avatar.outfit}
          isLocked={(color) => !has("outfit", color)}
          onPick={(outfit) => onChange({ outfit })}
        />
        <Swatches
          label="Detalhe"
          colors={[...ACCENT_COLORS, ...paidAccents]}
          selected={avatar.accent}
          isLocked={(color) => !has("accent", color)}
          onPick={(accent) => onChange({ accent })}
        />

        <Options
          label="Chapéu"
          options={[...HATS, ...paidHats]}
          selected={avatar.hat}
          onPick={(hat) => onChange({ hat })}
        />
        <Options
          label="Rosto"
          options={[...FACES, ...paidFaces]}
          selected={avatar.face}
          onPick={(face) => onChange({ face })}
        />

        <Link href="/loja" className="inline-block text-sm font-semibold text-beam-400 hover:underline">
          Ver a loja →
        </Link>
      </div>
    </div>
  );
}

function Swatches({
  label,
  colors,
  selected,
  onPick,
  isLocked,
}: {
  label: string;
  colors: string[];
  selected: string;
  onPick: (color: string) => void;
  isLocked?: (color: string) => boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => {
          const locked = isLocked?.(color) ?? false;
          return (
            <button
              key={color}
              type="button"
              aria-label={`${label}: ${color}${locked ? " (bloqueado)" : ""}`}
              aria-pressed={selected === color}
              disabled={locked}
              onClick={() => onPick(color)}
              style={{ background: color }}
              className={`relative size-8 rounded-lg border-2 transition ${
                selected === color
                  ? "border-beam-400 scale-110"
                  : "border-ink-700 hover:border-ink-600"
              } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
            >
              {locked && (
                <span className="absolute inset-0 grid place-content-center text-xs">🔒</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Options<T extends string>({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: { id: T; label: string; locked?: boolean; price?: number }[];
  selected: T;
  onPick: (id: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected === option.id}
            disabled={option.locked}
            onClick={() => onPick(option.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              selected === option.id
                ? "border-beam-500 bg-beam-500/10 text-beam-400"
                : "border-ink-600 text-mist-300 hover:border-ink-500"
            } ${option.locked ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {option.locked ? `🔒 ${option.label}` : option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
