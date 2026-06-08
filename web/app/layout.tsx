import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "leak.markets — The market decides what gets leaked",
  description:
    "Two competing Meteora DBC token pools vote with real capital to progressively decrypt content byte by byte. Powered by Lit Protocol v8 on Solana.",
  openGraph: {
    title: "leak.markets",
    description: "Capital-weighted progressive content decryption on Solana.",
    url: "https://leak.markets",
    siteName: "leak.markets",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "leak.markets",
    description: "The market decides what gets leaked.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0f]">
        <Nav />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-white/6 py-6 mt-16">
          <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-between gap-4 text-xs text-white/25 font-mono">
            <span>leak.markets — powered by Lit Protocol v8 + Meteora DBC + Solana</span>
            <span>not financial advice · trade responsibly</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
