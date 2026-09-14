"use client";

import type { Avatar as AvatarType } from "@/lib/types";

type Props = { avatar: AvatarType; size?: number; className?: string };

/**
 * Bonequinho do jogador: geometria propria em SVG, montada a partir das
 * escolhas de cor, chapeu e rosto. Sem imagens externas.
 */
export default function Avatar({ avatar, size = 48, className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Avatar do jogador"
    >
      {/* fundo */}
      <circle cx="32" cy="32" r="32" fill="#0d131f" />
      <circle cx="32" cy="32" r="30" fill={avatar.outfit} opacity="0.16" />

      {/* ombros */}
      <path d="M12 60c0-11 9-18 20-18s20 7 20 18v6H12z" fill={avatar.outfit} />
      <path d="M28 44h8v8a4 4 0 0 1-8 0z" fill={avatar.skin} />

      {/* cabeca */}
      <circle cx="32" cy="27" r="15" fill={avatar.skin} />

      <Face face={avatar.face} accent={avatar.accent} />
      <Hat hat={avatar.hat} accent={avatar.accent} outfit={avatar.outfit} />
    </svg>
  );
}

function Face({ face, accent }: { face: AvatarType["face"]; accent: string }) {
  const eyes =
    face === "focused" ? (
      <>
        <rect x="23" y="26" width="6" height="2.5" rx="1.25" fill="#141d2e" />
        <rect x="35" y="26" width="6" height="2.5" rx="1.25" fill="#141d2e" />
      </>
    ) : (
      <>
        <circle cx="26" cy="27" r="2.2" fill="#141d2e" />
        <circle cx="38" cy="27" r="2.2" fill="#141d2e" />
      </>
    );

  return (
    <>
      {face === "glasses" && (
        <g stroke={accent} strokeWidth="1.6" fill="none">
          <circle cx="26" cy="27" r="5" />
          <circle cx="38" cy="27" r="5" />
          <path d="M31 27h2" />
        </g>
      )}

      {face === "shades" ? (
        <g fill="#141d2e">
          <path d="M20 24h10v6a5 5 0 0 1-10 0z" />
          <path d="M34 24h10v6a5 5 0 0 1-10 0z" />
          <rect x="30" y="25" width="4" height="1.8" />
        </g>
      ) : (
        eyes
      )}

      {face === "focused" ? (
        <path d="M27 35h10" stroke="#141d2e" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      ) : (
        <path
          d="M26 33.5c2.2 3 9.8 3 12 0"
          stroke="#141d2e"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </>
  );
}

function Hat({
  hat,
  accent,
  outfit,
}: {
  hat: AvatarType["hat"];
  accent: string;
  outfit: string;
}) {
  switch (hat) {
    case "cap":
      return (
        <g>
          <path d="M17 20a15 15 0 0 1 30 0z" fill={accent} />
          <path d="M45 20h9a3 3 0 0 1 0 5H45z" fill={accent} opacity="0.8" />
        </g>
      );
    case "explorer":
      return (
        <g>
          <ellipse cx="32" cy="22" rx="24" ry="5" fill={accent} opacity="0.9" />
          <path d="M20 21a12 12 0 0 1 24 0z" fill={accent} />
          <rect x="20" y="18.5" width="24" height="3" fill={outfit} />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M17 21a15 15 0 0 1 30 0z" fill={accent} />
          <rect x="16" y="20" width="32" height="4.5" rx="2.2" fill={accent} opacity="0.75" />
          <circle cx="32" cy="8" r="3" fill={accent} />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path d="M16 28v-4a16 16 0 0 1 32 0v4" stroke={accent} strokeWidth="3" fill="none" />
          <rect x="12" y="26" width="7" height="11" rx="3.5" fill={accent} />
          <rect x="45" y="26" width="7" height="11" rx="3.5" fill={accent} />
        </g>
      );
    default:
      return null;
  }
}
