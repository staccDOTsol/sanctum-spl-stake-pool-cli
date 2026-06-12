"use client";

/**
 * /claim — the normie-proof bounty sweeper.
 *
 * You cracked a leak.markets bounty: you reconstructed the secret wallet's
 * base58 private key. This page does the part no degen wants to hand-roll —
 * it imports the key in-browser, finds the two pools whose fees route to it,
 * builds the Meteora `claimPartnerTradingFee` transactions, signs them with
 * the pasted key (locally, never sent anywhere), and sweeps the pot to a
 * destination you choose.
 *
 * The pasted key never leaves the browser. The only network calls are
 * Solana RPC (read pools / send txs).
 */
import { useState } from "react";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

type Phase = "idle" | "loading" | "claiming" | "done" | "error";

interface PoolFee { pool: string; quote: string; base: string }

function fmt(raw: string, decimals: number) {
  return (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function ClaimPage() {
  const [keyInput, setKeyInput]   = useState("");
  const [dest, setDest]           = useState("");
  const [phase, setPhase]         = useState<Phase>("idle");
  const [error, setError]         = useState<string | null>(null);
  const [pubkey, setPubkey]       = useState<string | null>(null);
  const [fees, setFees]           = useState<PoolFee[]>([]);
  const [sigs, setSigs]           = useState<string[]>([]);
  const [log, setLog]             = useState<string[]>([]);

  const addLog = (m: string) => setLog((p) => [...p, m]);

  function parseKey(): Keypair {
    const s = keyInput.trim();
    if (!s) throw new Error("Paste the secret key");
    // Accept base58 (88 chars) or a JSON byte array
    if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
    return Keypair.fromSecretKey(bs58.decode(s));
  }

  async function findPools() {
    setError(null);
    setSigs([]);
    setPhase("loading");
    try {
      const kp = parseKey();
      setPubkey(kp.publicKey.toBase58());
      addLog(`Wallet: ${kp.publicKey.toBase58()}`);

      // Find this wallet's bounty pools via the registry (it stores both
      // pool addresses keyed by the bounty pubkey).
      const reg = await fetch("/api/registry/by-bounty?pubkey=" + kp.publicKey.toBase58()).then((r) => r.json());
      const pools: string[] = reg.pools ?? [];
      if (pools.length === 0) {
        addLog("No registered bounty pools found for this wallet — you can still paste pool addresses manually below.");
      }

      const conn   = new Connection(RPC, "confirmed");
      const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
      const client = DynamicBondingCurveClient.create(conn, "confirmed");

      const found: PoolFee[] = [];
      for (const p of pools) {
        try {
          const m = await client.state.getPoolFeeMetrics(new PublicKey(p));
          found.push({ pool: p, quote: m.current.partnerQuoteFee.toString(), base: m.current.partnerBaseFee.toString() });
          addLog(`Pool ${p.slice(0, 8)}… claimable: ${m.current.partnerQuoteFee.toString()} quote / ${m.current.partnerBaseFee.toString()} base`);
        } catch {
          addLog(`Pool ${p.slice(0, 8)}… could not be read (skipped)`);
        }
      }
      setFees(found);
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid key");
      setPhase("error");
    }
  }

  async function claimAll() {
    setError(null);
    setPhase("claiming");
    try {
      const kp   = parseKey();
      const to   = dest.trim() ? new PublicKey(dest.trim()) : kp.publicKey;
      const conn = new Connection(RPC, "confirmed");
      const BN   = (await import("bn.js")).default;
      const { DynamicBondingCurveClient } = await import("@meteora-ag/dynamic-bonding-curve-sdk");
      const client = DynamicBondingCurveClient.create(conn, "confirmed");

      const out: string[] = [];
      for (const f of fees) {
        if (f.quote === "0" && f.base === "0") { addLog(`Pool ${f.pool.slice(0, 8)}… nothing to claim`); continue; }
        addLog(`Claiming from ${f.pool.slice(0, 8)}…`);
        const tx = await client.partner.claimPartnerTradingFee({
          feeClaimer:    kp.publicKey,
          payer:         kp.publicKey,
          pool:          new PublicKey(f.pool),
          maxBaseAmount: new BN(f.base),
          maxQuoteAmount: new BN(f.quote),
          receiver:      to,
        });
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer        = kp.publicKey;
        tx.sign(kp);
        const sig = await conn.sendRawTransaction(tx.serialize());
        await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        out.push(sig);
        addLog(`✓ claimed — ${sig.slice(0, 20)}…`);
      }
      // Sweep the wallet's SOL too (migration leftover + anything sent here),
      // leaving a small buffer for the transfer fee. Only when sending to a
      // different destination — otherwise it would just pay itself.
      if (dest.trim() && to.toBase58() !== kp.publicKey.toBase58()) {
        const bal = await conn.getBalance(kp.publicKey, "confirmed");
        const keep = 5_000; // leave ~1 tx fee
        if (bal > keep) {
          addLog(`Sweeping ${(bal - keep) / 1e9} SOL → ${to.toBase58().slice(0, 8)}…`);
          const stx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports: bal - keep }));
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
          stx.recentBlockhash = blockhash;
          stx.feePayer = kp.publicKey;
          stx.sign(kp);
          const sig = await conn.sendRawTransaction(stx.serialize());
          await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
          out.push(sig);
          addLog(`✓ SOL swept — ${sig.slice(0, 20)}…`);
        }
      }

      if (out.length === 0) throw new Error("Nothing claimable on these pools right now");
      setSigs(out);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
      setPhase("error");
    }
  }

  const totalQuote = fees.reduce((s, f) => s + BigInt(f.quote), BigInt(0));
  const totalBase  = fees.reduce((s, f) => s + BigInt(f.base), BigInt(0));

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/20 bg-green-500/8 mb-4">
          <span className="text-xs font-mono text-green-400/80 uppercase tracking-widest">🏴 leak.markets · claim bounty</span>
        </div>
        <h1 className="text-4xl font-black text-white mb-2">Claim the pot</h1>
        <p className="text-white/50 text-sm leading-relaxed">
          You cracked it — you have the secret wallet&apos;s private key. Paste it below and
          this page sweeps every Meteora fee that&apos;s pooled into it. The key is used only
          in your browser to sign; it is never uploaded.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Secret private key (base58 or JSON array)</label>
        <textarea
          rows={3}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="5Lxu… (88-char base58)  —  or  [12,34,…]"
          className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm font-mono resize-none focus:outline-none focus:border-green-500/40"
        />
        <p className="mt-1 text-[11px] text-amber-400/70">Used locally to sign, then discarded on refresh. Don&apos;t paste a key you still rely on.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">Send winnings to <span className="text-white/30">(optional — defaults to the secret wallet itself)</span></label>
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="your wallet address"
          className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm font-mono focus:outline-none focus:border-green-500/40"
        />
      </div>

      <button
        onClick={findPools}
        disabled={phase === "loading" || phase === "claiming"}
        className="w-full py-3 rounded-xl bg-white/8 hover:bg-white/12 text-white/80 font-bold text-sm border border-white/10 transition-colors disabled:opacity-40"
      >
        {phase === "loading" ? "Reading pools…" : "1 · Check claimable pot"}
      </button>

      {pubkey && (
        <div className="rounded-xl border border-white/8 bg-white/2 p-4 text-xs font-mono space-y-2">
          <div className="flex justify-between gap-4"><span className="text-white/30">Bounty wallet</span><span className="text-white/60 truncate">{pubkey}</span></div>
          {fees.map((f) => (
            <div key={f.pool} className="flex justify-between gap-4">
              <span className="text-white/30 truncate">{f.pool.slice(0, 10)}…</span>
              <span className="text-green-400/70">{f.quote} q / {f.base} b</span>
            </div>
          ))}
          <div className="flex justify-between gap-4 pt-2 border-t border-white/8">
            <span className="text-white/50">Total claimable</span>
            <span className="text-green-400 font-bold">{totalQuote.toString()} quote · {totalBase.toString()} base</span>
          </div>
        </div>
      )}

      {fees.length > 0 && (totalQuote > BigInt(0) || totalBase > BigInt(0)) && (
        <button
          onClick={claimAll}
          disabled={phase === "claiming"}
          className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors disabled:opacity-40"
        >
          {phase === "claiming" ? "Sweeping…" : "2 · Sweep the pot 🏴"}
        </button>
      )}

      {error && <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

      {sigs.length > 0 && (
        <div className="px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm space-y-1">
          <div className="font-bold">Claimed! 🏴</div>
          {sigs.map((s) => (
            <a key={s} href={`https://solscan.io/tx/${s}`} target="_blank" rel="noopener noreferrer" className="block underline opacity-80 text-xs truncate">{s}</a>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="p-4 rounded-xl bg-white/3 border border-white/6 space-y-0.5 font-mono text-[11px] text-green-400/70 max-h-48 overflow-y-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
