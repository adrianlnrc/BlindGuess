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
  if (face === "wink") {
    return (
      <>
        <path d="M23 27.5c1.6 -1.8 4.4 -1.8 6 0" stroke="#141d2e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="38" cy="27" r="2.2" fill="#141d2e" />
        <path d="M26 33.5c2.2 3 9.8 3 12 0" stroke="#141d2e" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </>
    );
  }

  if (face === "grin") {
    return (
      <>
        <circle cx="26" cy="27" r="2.2" fill="#141d2e" />
        <circle cx="38" cy="27" r="2.2" fill="#141d2e" />
        <path d="M25 33c1 4 12 4 14 0z" fill="#141d2e" />
        <path d="M26.6 34.4h10.8" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      </>
    );
  }

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

      {face === "eyepatch" && (
        <g>
          <path d="M20 24.5h11v6.5H20z" fill="#141d2e" />
          <path d="M19 23.5c4 -2 9 -2 13 0" stroke="#141d2e" strokeWidth="1.4" fill="none" />
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
    case "bucket":
      return (
        <g>
          <path d="M19 21a13 13 0 0 1 26 0z" fill={accent} />
          <path d="M14 21h36a4 4 0 0 1-4 5H18a4 4 0 0 1-4-5z" fill={accent} opacity="0.85" />
        </g>
      );
    case "visor":
      return (
        <g>
          <rect x="17" y="17.5" width="30" height="5" rx="2.5" fill={accent} />
          <path d="M45 18h10a3.5 3.5 0 0 1 0 6H45z" fill={accent} opacity="0.75" />
        </g>
      );
    case "helmet":
      return (
        <g>
          <path d="M16 27a16 16 0 0 1 32 0v1H16z" fill={accent} />
          <rect x="29.5" y="12" width="5" height="16" fill={outfit} opacity="0.9" />
          <rect x="14" y="26" width="36" height="3" rx="1.5" fill={accent} opacity="0.7" />
        </g>
      );
    case "crown":
      return (
        <g>
          <path d="M19 20l2-9 5.5 5.5L32 8l5.5 8.5L43 11l2 9z" fill={accent} />
          <rect x="19" y="19.5" width="26" height="3.5" rx="1.2" fill={accent} />
          <circle cx="32" cy="14.5" r="1.6" fill={outfit} />
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
