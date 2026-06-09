import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./gacha.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--gacha-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--mono",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "SWITCHEROO — Provably-Fair Token Gacha",
  description:
    "Delegate your bags, pay a roll fee, get swapped with a random stranger's. 0.86× to 10,000×. Provably fair on Solana slot hashes. No house edge — the edge pays it forward.",
};

export default function GachaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      {children}
    </div>
  );
}
