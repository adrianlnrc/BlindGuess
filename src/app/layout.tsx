import type { Metadata, Viewport } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

/** Voz pesada: títulos, placar, cronômetro, vida, moedas. */
const display = Outfit({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

/** Voz de leitura: tudo que é texto corrido e rótulo. */
const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BlindGuess — adivinhe onde você está",
  description:
    "Jogo de adivinhação geográfica em tempo real: caia num lugar aleatório do mundo e descubra onde está, com seus amigos.",
};

export const viewport: Viewport = {
  themeColor: "#110b20",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
