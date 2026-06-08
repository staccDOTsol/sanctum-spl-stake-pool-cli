"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";

const RPC      = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";
const SLIPPAGE  = 100; // 1%

const JUP_ULTRA_BASE = "https://ultra-api.jup.ag";
const JUP_API_KEY    = process.env.NEXT_PUBLIC_JUP_API_KEY
  ?? "jup_28e3ef642a4a17666d08a690bcfc996cb1838daf6856b478d383d5e816405b10";

interface UltraOrder {
  inAmount:    string;
  outAmount:   string;
  transaction: string; // base64 VersionedTransaction
  requestId:   string;
}

async function ultraOrder(
  inputMint:  string,
  outputMint: string,
  amount:     number,
  taker:      string,
): Promise<UltraOrder> {
  const url = new URL(`${JUP_ULTRA_BASE}/order`);
  url.searchParams.set("inputMint",  inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount",     String(Math.floor(amount)));
  url.searchParams.set("taker",      taker);
  url.searchParams.set("slippageBps", String(SLIPPAGE));
  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${JUP_API_KEY}` },
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(`Ultra order failed: ${(msg as { error?: string }).error ?? res.status}`);
  }
  return res.json();
}

async function ultraExecute(signedTxBase64: string, requestId: string): Promise<string> {
  const res = await fetch(`${JUP_ULTRA_BASE}/execute`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${JUP_API_KEY}`,
    },
    body: JSON.stringify({ signedTransaction: signedTxBase64, requestId }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(`Ultra execute failed: ${(msg as { error?: string }).error ?? res.status}`);
  }
  const data = await res.json() as { status: string; signature?: string; error?: string };
  if (data.status !== "Success") throw new Error(`Swap failed: ${data.error ?? data.status}`);
  return data.signature!;
}

async function ultraSwap(order: UltraOrder, wallet: WalletProvider): Promise<string> {
  const vTx    = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  const signed = await wallet.signTransaction(vTx) as VersionedTransaction;
  return ultraExecute(Buffer.from(signed.serialize()).toString("base64"), order.requestId);
}

// For display-only quote preview (no wallet needed)
async function jupiterPreviewQuote(inputMint: string, outputMint: string, amount: number) {
  const url = new URL("https://quote-api.jup.ag/v6/quote");
  url.searchParams.set("inputMint",   inputMint);
  url.searchParams.set("outputMint",  outputMint);
  url.searchParams.set("amount",      String(Math.floor(amount)));
  url.searchParams.set("slippageBps", String(SLIPPAGE));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Quote unavailable");
  return res.json() as Promise<{ outAmount: string }>;
}

// SDK hardcodes TOKEN_PROGRAM_ID for tokenQuoteProgram when quote is Token-2022.
function patchToken2022(tx: Transaction, quoteIsT22: boolean): Transaction {
  if (!quoteIsT22) return tx;
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.pubkey.equals(TOKEN_PROGRAM_ID)) key.pubkey = TOKEN_2022_PROGRAM_ID;
    }
  }
  return tx;
}

async function sendAndConfirm(
  conn:   Connection,
  tx:     Transaction,
  wallet: WalletProvider,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx) as Transaction;
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function dbcSwap(
  conn:             Connection,
  wallet:           WalletProvider,
  poolAddress:      string,
  amountIn:         bigint,
  swapBaseForQuote: boolean,
  quoteIsT22:       boolean,
): Promise<string> {
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const minOut = (amountIn * BigInt(10000 - SLIPPAGE * 2)) / BigInt(10000);
  const rawTx  = await client.pool.swap({
    owner:                wallet.publicKey,
    pool:                 new PublicKey(poolAddress),
    amountIn:             new BN(amountIn.toString()),
    minimumAmountOut:     new BN(minOut.toString()),
    swapBaseForQuote,
    referralTokenAccount: null,
  });
  return sendAndConfirm(conn, patchToken2022(rawTx, quoteIsT22), wallet);
}

function fmt(raw: string | number, decimals = 9) {
  return (Number(raw) / 10 ** decimals).toFixed(4);
}

export interface SwapWidgetProps {
  dontLeakPoolAddress: string;
  dontLeakMint:        string;
  quoteMint:           string;       // rfreestacc or GNcibpKH
  l1PoolAddress:       string;       // L1: quoteMint/LEAK pool
  quoteDecimals?:      number;       // 9 for rfreestacc, 6 for pump.fun
}

type Mode = "leak" | "dontleak";

export default function SwapWidget({
  dontLeakPoolAddress,
  quoteMint,
  l1PoolAddress,
  quoteDecimals = 9,
}: SwapWidgetProps) {
  const [mode, setMode]         = useState<Mode>("leak");
  const [wallet, setWallet]     = useState<WalletProvider | null>(null);
  const [solInput, setSolInput] = useState("0.1");
  const [leakPreview, setLeakPreview] = useState<string | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [log, setLog]           = useState<string[]>([]);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [done, setDone]         = useState<string | null>(null);
  const [quoteIsT22, setQuoteIsT22] = useState(true);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  useEffect(() => {
    const conn = new Connection(RPC, "confirmed");
    conn.getAccountInfo(new PublicKey(quoteMint)).then(info => {
      setQuoteIsT22(info?.owner.equals(TOKEN_2022_PROGRAM_ID) ?? true);
    }).catch(() => {});
  }, [quoteMint]);

  // Display-only preview from v6 (no wallet or taker needed)
  const fetchPreview = useCallback(async (sol: string) => {
    const lamports = parseFloat(sol) * 1e9;
    if (!lamports || lamports < 1000) { setLeakPreview(null); return; }
    try {
      setQuoteErr(null);
      const q = await jupiterPreviewQuote(SOL_MINT, LEAK_MINT, lamports);
      setLeakPreview(q.outAmount);
    } catch {
      setQuoteErr("Preview unavailable");
      setLeakPreview(null);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPreview(solInput), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [solInput, fetchPreview]);

  async function handleConnect() {
    try { setWallet(await connectWallet()); }
    catch (e) { setError(e instanceof Error ? e.message : "Wallet failed"); }
  }

  async function handleSwap() {
    if (!wallet) return;
    setError(null);
    setDone(null);
    setLog([]);
    setBusy(true);
    const conn = new Connection(RPC, "confirmed");
    try {
      const lamports = parseFloat(solInput) * 1e9;
      if (!lamports || lamports < 1000) throw new Error("Enter a valid SOL amount");

      // ── Step 1: Jupiter Ultra SOL → LEAK ────────────────────────────────
      addLog("Fetching Jupiter Ultra order (SOL → LEAK)…");
      const order   = await ultraOrder(SOL_MINT, LEAK_MINT, lamports, wallet.publicKey.toBase58());
      const leakOut = BigInt(order.outAmount);
      addLog(`~${fmt(lamports)} SOL → ~${fmt(leakOut.toString())} LEAK`);

      addLog("Sign tx 1 — SOL → LEAK (Jupiter Ultra)");
      const sig1 = await ultraSwap(order, wallet);
      addLog(`✓ LEAK in wallet  (${sig1.slice(0, 16)}…)`);

      // ── Step 2: DBC LEAK → quoteMint (L1 pool) ──────────────────────────
      // Skip if quoteMint IS LEAK (stable pools with no separate L1 pool yet)
      const needsL1Swap = !!l1PoolAddress && quoteMint !== LEAK_MINT;
      let quoteOut = leakOut;
      let lastSig  = sig1;

      if (needsL1Swap) {
        addLog("Sign tx 2 — LEAK → quoteMint (DBC L1)");
        lastSig  = await dbcSwap(conn, wallet, l1PoolAddress, leakOut, false, quoteIsT22);
        quoteOut = leakOut; // approximate; actual settled on-chain
        addLog(`✓ quoteMint received  (${lastSig.slice(0, 16)}…)`);
      } else {
        addLog("quoteMint = LEAK — skipping L1 pool swap");
      }

      if (mode === "leak") { setDone(lastSig); return; }

      // ── Step 3: DBC quoteMint → DontLeak (L2 content pool) ───────────────
      addLog(`Sign tx ${needsL1Swap ? 3 : 2} — quoteMint → DontLeak (DBC L2)`);
      const sig3 = await dbcSwap(conn, wallet, dontLeakPoolAddress, quoteOut, false, quoteIsT22);
      addLog(`✓ DontLeak received  (${sig3.slice(0, 16)}…)`);
      setDone(sig3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  }

  const isLeak = mode === "leak";

  return (
    <div className={`rounded-2xl border bg-[#13131a] p-5 ${isLeak ? "border-green-500/20" : "border-red-500/20"}`}>
      {/* Mode toggle */}
      <div className="flex rounded-xl overflow-hidden border border-white/8 mb-5">
        {(["leak", "dontleak"] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); setDone(null); setLog([]); }}
            className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
              mode === m
                ? m === "leak"
                  ? "bg-green-500/15 text-green-400"
                  : "bg-red-500/15 text-red-400"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            {m === "leak" ? "📈 Buy Leak" : "🔐 Buy DontLeak"}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="block text-xs font-mono text-white/40 mb-1.5">SOL amount</label>
        <div className="flex gap-2">
          <input
            type="number" min="0" step="0.01" value={solInput}
            onChange={e => setSolInput(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/30"
          />
          {["0.1","0.5","1"].map(v => (
            <button key={v} onClick={() => setSolInput(v)}
              className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/8 text-white/40 hover:text-white/70 text-xs transition-colors">
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Quote preview */}
      <div className="mb-4 p-3 rounded-lg bg-white/3 border border-white/6 text-xs font-mono space-y-1">
        <div className="flex justify-between">
          <span className="text-white/30">SOL in</span>
          <span className="text-white/60">{solInput || "—"} SOL</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">→ LEAK</span>
          <span className={quoteErr ? "text-red-400/60" : "text-green-400/70"}>
            {quoteErr ?? (leakPreview ? `~${fmt(leakPreview)}` : "…")}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">→ quoteMint</span>
          <span className="text-white/40">~market rate (DBC L1)</span>
        </div>
        {!isLeak && (
          <div className="flex justify-between">
            <span className="text-white/30">→ DontLeak</span>
            <span className="text-red-400/70">~market rate (DBC L2)</span>
          </div>
        )}
        <div className="pt-1 text-white/20 text-[10px]">
          {isLeak ? "2 txs: Jupiter Ultra SOL→LEAK, DBC LEAK→quoteMint" : "3 txs: Jupiter Ultra SOL→LEAK, DBC LEAK→quote, DBC quote→DontLeak"}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
      )}

      {done && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
          ✓ Done!{" "}
          <a href={`https://solscan.io/tx/${done}`} target="_blank" rel="noopener noreferrer" className="underline opacity-70">View tx</a>
        </div>
      )}

      {log.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-white/3 border border-white/6 space-y-0.5 font-mono text-[11px] text-green-400/70 max-h-32 overflow-y-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
          {busy && <div className="inline-block w-1.5 h-2.5 bg-green-400/60 animate-pulse ml-0.5" />}
        </div>
      )}

      {wallet ? (
        <button
          onClick={handleSwap}
          disabled={busy}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isLeak ? "bg-green-500 hover:bg-green-400 text-black" : "bg-red-500 hover:bg-red-400 text-white"
          }`}
        >
          {busy ? "Swapping…" : isLeak ? "Buy Leak →" : "Buy DontLeak →"}
        </button>
      ) : (
        <button onClick={handleConnect}
          className="w-full py-3 rounded-xl bg-white/8 hover:bg-white/12 text-white/70 font-bold text-sm border border-white/10 transition-colors">
          Connect Wallet to Swap
        </button>
      )}

      <p className="mt-2 text-center text-[10px] text-white/20 font-mono">
        {wallet ? wallet.publicKey.toBase58().slice(0, 16) + "…" : "Phantom / Solflare"}
      </p>
    </div>
  );
}
