"use client";

import Avatar from "./Avatar";
import { ACCENT_COLORS, OUTFIT_COLORS, SKIN_TONES } from "@/lib/profile";
import type { Avatar as AvatarType, FaceId, HatId } from "@/lib/types";

type Props = {
  avatar: AvatarType;
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

export default function AvatarEditor({ avatar, onChange }: Props) {
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
          colors={OUTFIT_COLORS}
          selected={avatar.outfit}
          onPick={(outfit) => onChange({ outfit })}
        />
        <Swatches
          label="Detalhe"
          colors={ACCENT_COLORS}
          selected={avatar.accent}
          onPick={(accent) => onChange({ accent })}
        />

        <Options
          label="Chapéu"
          options={HATS}
          selected={avatar.hat}
          onPick={(hat) => onChange({ hat })}
        />
        <Options
          label="Rosto"
          options={FACES}
          selected={avatar.face}
          onPick={(face) => onChange({ face })}
        />
      </div>
    </div>
  );
}

function Swatches({
  label,
  colors,
  selected,
  onPick,
}: {
  label: string;
  colors: string[];
  selected: string;
  onPick: (color: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs tracking-widest text-mist-300 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label}: ${color}`}
            aria-pressed={selected === color}
            onClick={() => onPick(color)}
            style={{ background: color }}
            className={`size-8 rounded-lg border-2 transition ${
              selected === color ? "border-beam-400 scale-110" : "border-ink-700 hover:border-ink-600"
            }`}
          />
        ))}
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
  options: { id: T; label: string }[];
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
            onClick={() => onPick(option.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              selected === option.id
                ? "border-beam-500 bg-beam-500/10 text-beam-400"
                : "border-ink-600 text-mist-300 hover:border-ink-500"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
