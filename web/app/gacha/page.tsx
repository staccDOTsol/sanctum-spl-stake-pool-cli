"use client";

// THE SWITCHEROO — real, mainnet-only dApp. No simulation.
// Connect a wallet (any Wallet Standard wallet), delegate real SPL tokens to the
// matchmaker (approve + close authority), pay a real roll fee, and the offchain
// matchmaker executes the swap. The reveal renders the matchmaker's actual
// recorded result + provably-fair receipt (polled from /api/gacha/swaps/:pubkey).

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  THEMES, Pull, LiveStats, SwapRecord, topRarity, pullFromSwap, fetchTokenMeta, fmtSol,
} from "@/lib/gacha/data";
import {
  getConfig, getSolBalance, loadHoldings, fetchPrices,
  buildDelegateTxs, buildRollTx, sendRaw, type Holding,
} from "@/lib/gacha/chain";
import { connect as connectWallet, type ConnectedWallet } from "@/lib/gacha/wallet";
import { Starfield, useScreenShake } from "@/components/gacha/Fx";
import { WishOverlay, RevealCard } from "@/components/gacha/Reveal";
import { SummaryGrid, Receipt, HistoryDrawer } from "@/components/gacha/Extras";
import { ApprovalSheet, type PricedHolding } from "@/components/gacha/Approval";
import { Banner, type PointsInfo } from "@/components/gacha/Banner";
import { WalletPicker } from "@/components/gacha/WalletPicker";

const THEME = THEMES.astral;
const INTENSITY = 80;
type Stage = "banner" | "resolving" | "wishing" | "reveal" | "summary";

export default function GachaPage() {
  const [mounted, setMounted] = useState(false);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [balance, setBalance] = useState(0);
  const [holdings, setHoldings] = useState<PricedHolding[]>([]);
  const [live, setLive] = useState<LiveStats | null>(null);
  const [points, setPoints] = useState<PointsInfo | null>(null);
  const [pity, setPity] = useState(0);
  const [streak, setStreak] = useState(0);
  const [jackpotSol, setJackpotSol] = useState(0);

  const [stage, setStage] = useState<Stage>("banner");
  const [showApproval, setShowApproval] = useState(false);
  const [threshold, setThreshold] = useState(150);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [rollBusy, setRollBusy] = useState<string | null>(null);

  const [pulls, setPulls] = useState<Pull[]>([]);
  const [isMulti, setIsMulti] = useState(false);
  const [receipt, setReceipt] = useState<Pull | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Pull[]>([]);
  const [jackpotWin, setJackpotWin] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [shaking, shake] = useScreenShake();
  const resolvingNote = useRef("Resolving slot hash…");
  const cancelRef = useRef(false);

  useEffect(() => { setMounted(true); document.body.classList.add("gacha-mode"); return () => document.body.classList.remove("gacha-mode"); }, []);

  // live stats poll (pool size, jackpot, fee)
  useEffect(() => {
    let off = false;
    const load = () => fetch("/api/gacha/stats").then(r => r.ok ? r.json() : null)
      .then(s => { if (!off && s && typeof s.poolSize === "number") { setLive(s); setJackpotSol(s.jackpotSol || 0); } })
      .catch(() => {});
    load(); const id = setInterval(load, 20_000); return () => { off = true; clearInterval(id); };
  }, []);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  // Pull together everything that depends on the connected wallet.
  const refresh = useCallback(async (w: ConnectedWallet) => {
    const pk = w.publicKey;
    const [bal, hs] = await Promise.all([
      getSolBalance(pk).catch(() => 0),
      loadHoldings(pk).catch(() => [] as Holding[]),
    ]);
    setBalance(bal);
    const prices = await fetchPrices(hs.map(h => h.mint));
    const priced: PricedHolding[] = await Promise.all(hs.map(async h => {
      const price = prices.get(h.mint) ?? null;
      const meta = await fetchTokenMeta(h.mint);
      return { ...h, symbol: meta.symbol || (h.mint.slice(0, 4) + "…"), usd: price !== null ? price * h.uiAmount : null };
    }));
    setHoldings(priced);

    const base = w.publicKey.toBase58();
    fetch(`/api/gacha/pity/${base}`).then(r => r.ok ? r.json() : null).then(p => {
      if (p) { setPity(p.pity ?? 0); setStreak(p.streak ?? 0); }
    }).catch(() => {});
    fetch(`/api/gacha/points/${base}`).then(r => r.ok ? r.json() : null).then(p => {
      if (p && p.pubkey) setPoints({
        rollNumber: p.rollNumber, totalRollers: p.totalRolls ? Math.max(p.rollNumber, 1) : p.rollNumber,
        cumulativePoints: p.cumulativePoints, totalEarnedSol: parseFloat(p.totalEarnedSOL || "0"), pendingSol: parseFloat(p.pendingSOL || "0"),
      });
    }).catch(() => {});
    fetch(`/api/gacha/swaps/${base}`).then(r => r.ok ? r.json() : null).then(async d => {
      if (d?.swaps) setHistory(await mapPulls(d.swaps));
    }).catch(() => {});
  }, []);

  const doConnect = useCallback(async (name: string) => {
    try {
      const w = await connectWallet(name);
      setWallet(w);
      setShowPicker(false);
      await getConfig(); // warm config (rpc, matchmaker)
      await refresh(w);
    } catch (e) {
      showToast((e as Error).message || "Failed to connect");
    }
  }, [refresh]);

  const delegatedCount = holdings.filter(h => h.delegated).length;
  const delegatedUsd = (() => {
    const d = holdings.filter(h => h.delegated);
    if (d.length === 0 || d.some(h => h.usd === null)) return null;
    return Math.round(d.reduce((s, h) => s + (h.usd ?? 0), 0));
  })();

  const onApprove = useCallback(async (selected: PricedHolding[]) => {
    if (!wallet) return;
    setApprovalError(null);
    try {
      const txs = await buildDelegateTxs(wallet.publicKey, selected);
      for (let i = 0; i < txs.length; i++) {
        setApprovalBusy(`Sign batch ${i + 1}/${txs.length}…`);
        await wallet.signAndSend(txs[i], sendRaw);
      }
      setApprovalBusy("Confirming…");
      await refresh(wallet);
      setApprovalBusy(null);
      setShowApproval(false);
      showToast(`Delegated ${selected.length} token${selected.length > 1 ? "s" : ""} — pool armed ⇄`);
    } catch (e) {
      setApprovalBusy(null);
      setApprovalError((e as Error).message || "Approval failed / rejected");
    }
  }, [wallet, refresh]);

  const doRoll = useCallback(async (count: number) => {
    if (!wallet) { setShowPicker(true); return; }
    if (delegatedCount === 0) { setShowApproval(true); return; }
    const base = wallet.publicKey.toBase58();
    try {
      // Pre-flight: don't charge a roll fee that can't produce a swap. A swap
      // needs ≥2 distinct delegated owners (you + someone else).
      setRollBusy("Checking pool…");
      const pre = await fetch("/api/gacha/stats", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (pre && (pre.poolOwners ?? 0) < 2) {
        setRollBusy(null);
        showToast("No counterparty yet — the pool needs a second delegated wallet before any swap can happen. You're the only one in right now, so your fee wasn't charged.");
        return;
      }

      setRollBusy("Sign roll…");
      cancelRef.current = false;
      // baseline: which of my swaps already exist
      const before = await fetch(`/api/gacha/swaps/${base}`).then(r => r.ok ? r.json() : { swaps: [] }).catch(() => ({ swaps: [] }));
      const seen = new Set<string>((before.swaps ?? []).map((s: SwapRecord) => s.signature));

      const tx = await buildRollTx(wallet.publicKey, count);
      await wallet.signAndSend(tx, sendRaw);

      setRollBusy(null);
      setIsMulti(count > 1);
      resolvingNote.current = "Matchmaker resolving slot hash…";
      setStage("resolving");

      // poll for the matchmaker's executed swap(s)
      const fresh = await pollForSwaps(base, seen, count, 60_000, () => cancelRef.current);
      if (cancelRef.current) { refresh(wallet); return; }
      if (fresh.length === 0) {
        setStage("banner");
        showToast("No same-tier counterparty resolved in time — your fee funded the jackpot + dividends. Try again as the pool fills.");
        refresh(wallet);
        return;
      }
      const newPulls = await mapPulls(fresh);
      setPulls(newPulls);
      const won = fresh.reduce((s, r) => s + (r.jackpotWonLamports || 0), 0);
      setStage("wishing");
      // banks/pity refresh in background
      refresh(wallet);
      if (won > 0) { setJackpotWin(won / 1e9); }
    } catch (e) {
      setRollBusy(null);
      setStage("banner");
      showToast((e as Error).message || "Roll failed / rejected");
    }
  }, [wallet, delegatedCount, refresh]);

  const onWishDone = useCallback(() => {
    const top = topRarity(pulls);
    if (top === "legendary" || top === "jackpot") shake(top === "jackpot" ? 2 : 1);
    if (jackpotWin > 0) shake(2);
    setStage(isMulti ? "summary" : "reveal");
  }, [pulls, isMulti, shake, jackpotWin]);

  const reset = () => { setStage("banner"); setPulls([]); };

  const shakeStyle: CSSProperties = shaking ? { animation: `shake${shaking > 1 ? "Big" : ""} .55s cubic-bezier(.36,.07,.19,.97)` } : {};

  if (!mounted) return <div className="gacha-root" style={{ position: "fixed", inset: 0, zIndex: 70, background: THEME.bg2 }} />;

  return (
    <div className="gacha-root" style={{
      position: "fixed", inset: 0, zIndex: 70, overflow: "hidden",
      background: `radial-gradient(ellipse 90% 60% at 50% -5%, ${THEME.glow} 0%, transparent 55%), linear-gradient(180deg, ${THEME.bg1}, ${THEME.bg2})`,
      ...shakeStyle,
    }}>
      <Starfield hue={THEME.hue} density={0.9} />

      <a href="https://stacsol.app" target="_blank" rel="noopener noreferrer" style={{
        position: "relative", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        padding: "7px 16px", background: "rgba(124,255,178,0.07)", borderBottom: "1px solid rgba(124,255,178,0.15)",
        textDecoration: "none", fontFamily: "var(--mono)", fontSize: 12,
      }}>
        <span style={{ color: "rgba(255,255,255,0.5)" }}>Tired of gambling?</span>
        <span style={{ color: "#7CFFB2", fontWeight: 700 }}>stacsol.app</span>
        <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
        <span style={{ color: "#7CFFB2", fontWeight: 700 }}>degensol.app</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>↗</span>
      </a>

      <div style={{ position: "relative", zIndex: 10, height: "calc(100% - 35px)", overflowY: "auto" }}>
        {stage === "banner" && (
          <Banner
            connected={!!wallet} address={wallet?.publicKey.toBase58() ?? null} solBalance={balance}
            holdingsCount={holdings.length} delegatedCount={delegatedCount} delegatedUsd={delegatedUsd}
            pity={pity} streak={streak} jackpotSol={jackpotSol} live={live} points={points} busyRoll={rollBusy}
            onConnect={() => setShowPicker(true)} onApprove={() => setShowApproval(true)}
            onRoll={doRoll} onHistory={() => setShowHistory(true)}
          />
        )}
        {stage === "reveal" && pulls[0] && (
          <Stage>
            <RevealCard pull={pulls[0]} intensity={INTENSITY} big onReceipt={() => setReceipt(pulls[0])} />
            <AfterActions onAgain={() => doRoll(1)} onAgain10={() => doRoll(10)} onHome={reset} />
          </Stage>
        )}
        {stage === "summary" && (
          <Stage>
            <div style={{ marginBottom: 22, textAlign: "center" }}>
              <div style={{ fontSize: 13, letterSpacing: "0.4em", color: THEME.hue, fontFamily: "var(--mono)", fontWeight: 700 }}>{pulls.length}× SWITCHEROO RESULTS</div>
            </div>
            <SummaryGrid pulls={pulls} onReceipt={setReceipt} />
            <AfterActions onAgain={() => doRoll(1)} onAgain10={() => doRoll(10)} onHome={reset} />
          </Stage>
        )}
      </div>

      {stage === "resolving" && <Resolving note={resolvingNote.current} onCancel={() => { cancelRef.current = true; setStage("banner"); }} />}
      {stage === "wishing" && <WishOverlay pulls={pulls} isMulti={isMulti} fast={false} onDone={onWishDone} />}

      {showPicker && <WalletPicker onPick={doConnect} onClose={() => setShowPicker(false)} />}
      {showApproval && wallet && (
        <ApprovalSheet holdings={holdings} threshold={threshold} setThreshold={setThreshold}
          busy={approvalBusy} error={approvalError}
          onApprove={onApprove} onClose={() => { if (!approvalBusy) { setShowApproval(false); setApprovalError(null); } }} />
      )}
      {receipt && <Receipt pull={receipt} onClose={() => setReceipt(null)} />}
      {jackpotWin > 0 && <JackpotWin amountSol={jackpotWin} onClose={() => setJackpotWin(0)} />}
      <HistoryDrawer open={showHistory} history={history} onClose={() => setShowHistory(false)}
        onReceipt={(p) => { setShowHistory(false); setReceipt(p); }} />

      {toast && (
        <div style={{
          position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 80,
          maxWidth: "90%", padding: "12px 18px", borderRadius: 12, background: "rgba(20,18,31,0.95)",
          border: "1px solid rgba(255,255,255,0.14)", color: "#fff", fontSize: 13, fontFamily: "var(--mono)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)", textAlign: "center", animation: "fadein .2s ease",
        }}>{toast}</div>
      )}
    </div>
  );
}

// Build display Pulls from real swap records (fetches token metadata).
async function mapPulls(recs: SwapRecord[]): Promise<Pull[]> {
  return Promise.all(recs.map(async r => pullFromSwap(r, await fetchTokenMeta(r.counterpartyMint))));
}

// Poll /swaps/:pubkey until `count` new records appear (or timeout). Returns
// the new records oldest-first so the 10-pull reveals in roll order.
async function pollForSwaps(base: string, seen: Set<string>, count: number, timeoutMs: number, cancelled: () => boolean): Promise<SwapRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let stableEmpty = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    if (cancelled()) return [];
    try {
      const d = await fetch(`/api/gacha/swaps/${base}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null);
      const fresh: SwapRecord[] = (d?.swaps ?? []).filter((s: SwapRecord) => s.requester === base && !seen.has(s.signature));
      if (fresh.length >= count) return fresh.slice(0, count).reverse();
      if (fresh.length > 0) { stableEmpty++; if (stableEmpty >= 3) return fresh.reverse(); }
    } catch { /* keep polling */ }
  }
  return [];
}

function Resolving({ note, onCancel }: { note: string; onCancel: () => void }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const id = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(id); }, []);
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, overflow: "hidden", background: "#04020c" }}>
      <Starfield warp hue="#b8a6ff" density={1.4} />
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
      }}>
        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 0 40px 14px #b8a6ff, 0 0 120px 40px #b8a6ff", animation: "aurabreath 1.4s ease-in-out infinite" }} />
        <div style={{ color: "rgba(255,255,255,0.6)", fontFamily: "var(--mono)", fontSize: 13, letterSpacing: "0.3em", animation: "fadepulse 1.4s ease-in-out infinite" }}>{note.toUpperCase()}</div>
        <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--mono)", fontSize: 11 }}>the matchmaker swaps within ~1–2 slots · real on-chain swap · {secs}s</div>
        <button onClick={onCancel} style={{
          marginTop: 18, padding: "9px 20px", borderRadius: 10, cursor: "pointer",
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)",
          color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 13, fontFamily: "inherit",
        }}>← Back to banner</button>
      </div>
    </div>
  );
}

function JackpotWin({ amountSol, onClose }: { amountSol: number; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 65, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
      background: "radial-gradient(circle at 50% 40%, rgba(255,203,69,0.22), rgba(4,2,12,0.92))",
      backdropFilter: "blur(6px)", animation: "fadein .25s ease",
    }}>
      <div style={{ fontSize: 64, animation: "aurabreath 1.6s ease-in-out infinite" }}>🎰</div>
      <div style={{ fontSize: 13, letterSpacing: "0.4em", color: "#ffcb45", fontFamily: "var(--mono)", fontWeight: 800, marginTop: 8 }}>PROGRESSIVE JACKPOT</div>
      <div style={{ fontSize: "clamp(40px, 9vw, 84px)", fontWeight: 900, lineHeight: 1, marginTop: 8, color: "#ffe27d", fontFamily: "var(--mono)", textShadow: "0 0 40px rgba(255,203,69,0.8)" }}>{fmtSol(amountSol)}</div>
      <div style={{ marginTop: 14, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>Paid to your wallet on-chain. Provably fair off the same slot hash.</div>
      <button onClick={onClose} style={{
        marginTop: 26, padding: "12px 28px", borderRadius: 12, border: "none", cursor: "pointer",
        background: "linear-gradient(90deg,#ffcb45,#ff8a3d)", color: "#1a0f02", fontWeight: 800, fontSize: 15,
        boxShadow: "0 10px 34px rgba(255,203,69,0.45)",
      }}>Claim & keep wishing</button>
    </div>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      {children}
    </div>
  );
}

function AfterActions({ onAgain, onAgain10, onHome }: { onAgain: () => void; onAgain10: () => void; onHome: () => void }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap", justifyContent: "center" }}>
      <button onClick={onHome} style={ghostBtn}>← Banner</button>
      <button onClick={onAgain} style={ghostBtn}>Wish ×1</button>
      <button onClick={onAgain10} style={primaryBtn}>Wish ×10 again</button>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  padding: "12px 22px", borderRadius: 12, cursor: "pointer",
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)",
  color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: 14, fontFamily: "inherit",
};
const primaryBtn: CSSProperties = {
  padding: "12px 24px", borderRadius: 12, cursor: "pointer", border: "none",
  background: "linear-gradient(90deg, #b06bff, #7a32d6)", color: "#fff", fontWeight: 800, fontSize: 14,
  boxShadow: "0 8px 28px rgba(176,107,255,0.4)", fontFamily: "inherit",
};
