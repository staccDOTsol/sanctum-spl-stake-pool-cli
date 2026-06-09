"use client";

import { useEffect, useState } from "react";
import { listWallets, onWalletsChange, type WalletInfo } from "@/lib/gacha/wallet";

export function WalletPicker({ onPick, onClose }: {
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);

  useEffect(() => {
    const refresh = () => setWallets(listWallets());
    refresh();
    return onWalletsChange(refresh);
  }, []);

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(4,2,12,0.82)", backdropFilter: "blur(8px)", padding: 20, animation: "fadein .2s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(420px, 100%)", borderRadius: 20, overflow: "hidden",
        background: "linear-gradient(180deg, #14121f, #0b0a14)",
        border: "1px solid rgba(176,107,255,0.25)", boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(176,107,255,0.15)",
      }}>
        <div style={{ padding: "20px 24px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⇄</span>
          <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>Connect a wallet</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "0 16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {wallets.length === 0 && (
            <div style={{ textAlign: "center", padding: "26px 16px", color: "rgba(255,255,255,0.5)", fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6 }}>
              No Solana wallet detected.<br />
              Install <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" style={{ color: "#b06bff" }}>Phantom</a>,{" "}
              <a href="https://solflare.com" target="_blank" rel="noopener noreferrer" style={{ color: "#b06bff" }}>Solflare</a>, or{" "}
              <a href="https://backpack.app" target="_blank" rel="noopener noreferrer" style={{ color: "#b06bff" }}>Backpack</a>.
            </div>
          )}
          {wallets.map(w => (
            <button key={w.name} onClick={() => onPick(w.name)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 12, cursor: "pointer",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", textAlign: "left",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.icon} alt="" width={28} height={28} style={{ borderRadius: 7 }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{w.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "var(--mono)" }}>detected</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
