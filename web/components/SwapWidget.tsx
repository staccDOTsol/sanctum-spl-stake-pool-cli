"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";

const RPC      = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";
const SLIPPAGE  = 100; // 1%

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

async function jupiterQuote(inputMint: string, outputMint: string, amount: number) {
  const url = new URL("https://quote-api.jup.ag/v6/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(Math.floor(amount)));
  url.searchParams.set("slippageBps", String(SLIPPAGE));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Jupiter quote failed");
  return res.json();
}

async function jupiterSwapTx(quoteResponse: unknown, userPublicKey: string): Promise<Transaction> {
  const res = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      asLegacyTransaction: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!res.ok) throw new Error("Jupiter swap request failed");
  const { swapTransaction } = await res.json();
  return Transaction.from(Buffer.from(swapTransaction, "base64"));
}

async function sendAndConfirm(
  conn: Connection,
  tx: Transaction,
  wallet: WalletProvider,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function dbcSwap(
  conn: Connection,
  wallet: WalletProvider,
  poolAddress: string,
  amountIn: bigint,
  swapBaseForQuote: boolean, // false = paying quote to receive base
  quoteIsT22: boolean,
): Promise<string> {
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const minOut = (amountIn * BigInt(10000 - SLIPPAGE * 2)) / BigInt(10000);
  const rawTx = await client.pool.swap({
    owner:               wallet.publicKey,
    pool:                new PublicKey(poolAddress),
    amountIn:            new BN(amountIn.toString()),
    minimumAmountOut:    new BN(minOut.toString()),
    swapBaseForQuote,
    referralTokenAccount: null,
  });
  return sendAndConfirm(conn, patchToken2022(rawTx, quoteIsT22), wallet);
}

function fmt(raw: string | number, decimals = 9) {
  return (Number(raw) / 10 ** decimals).toFixed(4);
}

export interface SwapWidgetProps {
  dontLeakPoolAddress: string;  // L2: DontLeak/quoteMint
  dontLeakMint: string;
  quoteMint: string;            // rfreestacc or GNcibpKH
  l1PoolAddress: string;        // L1: quoteMint/LEAK pool
  quoteDecimals?: number;       // 9 for rfreestacc, 6 for pump.fun
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [jupQuote, setJupQuote] = useState<any>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [log, setLog]           = useState<string[]>([]);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [done, setDone]         = useState<string | null>(null);
  const [quoteIsT22, setQuoteIsT22] = useState(true);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  // Detect quote mint token program once
  useEffect(() => {
    const conn = new Connection(RPC, "confirmed");
    conn.getAccountInfo(new PublicKey(quoteMint)).then(info => {
      setQuoteIsT22(info?.owner.equals(TOKEN_2022_PROGRAM_ID) ?? true);
    }).catch(() => {});
  }, [quoteMint]);

  const fetchQuote = useCallback(async (sol: string) => {
    const lamports = parseFloat(sol) * 1e9;
    if (!lamports || lamports < 1000) { setJupQuote(null); return; }
    try {
      setQuoteErr(null);
      const q = await jupiterQuote(SOL_MINT, LEAK_MINT, lamports);
      setJupQuote(q);
    } catch {
      setQuoteErr("Quote unavailable");
      setJupQuote(null);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(solInput), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [solInput, fetchQuote]);

  async function handleConnect() {
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet failed");
    }
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

      // ── Step 1: Jupiter SOL → LEAK ───────────────────────────────────────
      addLog("Fetching Jupiter quote (SOL → LEAK)…");
      const quote    = await jupiterQuote(SOL_MINT, LEAK_MINT, lamports);
      const leakOut  = BigInt(quote.outAmount as string);
      addLog(`~${fmt(lamports)} SOL → ${fmt(leakOut.toString())} LEAK`);

      addLog("Sign tx 1 — SOL → LEAK (Jupiter)");
      const jupTx = await jupiterSwapTx(quote, wallet.publicKey.toBase58());
      const sig1  = await sendAndConfirm(conn, jupTx, wallet);
      addLog(`✓ LEAK in wallet  (${sig1.slice(0, 16)}…)`);

      // ── Step 2: DBC LEAK → quoteMint (L1 pool) ──────────────────────────
      // swapBaseForQuote: false = paying LEAK (quote in L1) to receive quoteMint (base in L1)
      if (!l1PoolAddress) throw new Error("L1 pool address not configured — set NEXT_PUBLIC_STABLE_L1_POOL / MEME_L1_POOL");
      addLog("Sign tx 2 — LEAK → quoteMint (DBC L1)");
      const sig2     = await dbcSwap(conn, wallet, l1PoolAddress, leakOut, false, quoteIsT22);
      const quoteOut = leakOut; // approximate; actual amount settled on-chain
      addLog(`✓ quoteMint received  (${sig2.slice(0, 16)}…)`);

      if (mode === "leak") { setDone(sig2); return; }

      // ── Step 3: DBC quoteMint → DontLeak (L2 content pool) ───────────────
      addLog("Sign tx 3 — quoteMint → DontLeak (DBC L2)");
      const sig3 = await dbcSwap(conn, wallet, dontLeakPoolAddress, quoteOut, false, quoteIsT22);
      addLog(`✓ DontLeak received  (${sig3.slice(0, 16)}…)`);
      setDone(sig3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  }

  const leakAmount = jupQuote ? fmt(jupQuote.outAmount) : null;
  const isLeak     = mode === "leak";

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
            {m === "leak" ? "📈 Buy Quote" : "🔐 Buy DontLeak"}
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
            {quoteErr ?? (leakAmount ? `~${leakAmount}` : "…")}
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
          {isLeak ? "2 txs: Jupiter SOL→LEAK, DBC LEAK→quoteMint" : "3 txs: Jupiter SOL→LEAK, DBC LEAK→quote, DBC quote→DontLeak"}
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
          disabled={busy || !jupQuote}
          className={`w-full py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isLeak ? "bg-green-500 hover:bg-green-400 text-black" : "bg-red-500 hover:bg-red-400 text-white"
          }`}
        >
          {busy ? "Swapping…" : isLeak ? "Buy Quote Token →" : "Buy DontLeak →"}
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
