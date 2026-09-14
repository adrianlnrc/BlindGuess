"use client";

import { DEFAULT_AVATAR, type Avatar, type PlayerProfile } from "./types";

const PROFILE_KEY = "blindguess:profile";

export const SKIN_TONES = ["#f3d0b3", "#e0ab82", "#c98d63", "#a4673f", "#6f4427", "#4a2d1a"];
export const OUTFIT_COLORS = ["#16b886", "#4f8df9", "#f4628a", "#ffb454", "#a86ff0", "#e2e8f0"];
export const ACCENT_COLORS = ["#ffb454", "#35d6a4", "#f4628a", "#6aa8ff", "#facc15", "#0d131f"];

function randomId(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
}

function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Perfil novo com aparencia sorteada, para o jogador ja abrir o jogo com cara de alguem. */
export function createProfile(name = ""): PlayerProfile {
  return {
    id: randomId(),
    name,
    avatar: {
      ...DEFAULT_AVATAR,
      skin: randomFrom(SKIN_TONES),
      outfit: randomFrom(OUTFIT_COLORS),
      accent: randomFrom(ACCENT_COLORS),
    },
  };
}

/** Le o perfil salvo; cria um novo na primeira visita. */
export function loadProfile(): PlayerProfile {
  if (typeof window === "undefined") return createProfile();

  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
      if (parsed.id) {
        return {
          id: parsed.id,
          name: parsed.name ?? "",
          avatar: { ...DEFAULT_AVATAR, ...(parsed.avatar as Avatar | undefined) },
        };
      }
    }
  } catch {
    // localStorage bloqueado ou JSON corrompido: comeca de novo
  }

  const fresh = createProfile();
  saveProfileLocal(fresh);
  return fresh;
}

export function saveProfileLocal(profile: PlayerProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // modo anonimo: segue sem persistir
  }
}
