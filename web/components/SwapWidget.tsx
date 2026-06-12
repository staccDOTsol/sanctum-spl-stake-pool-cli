"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";

const RPC      = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";
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
  // Ultra returns an order without a transaction when the taker can't cover
  // amount + fees (or no route) — deserializing nothing throws the cryptic
  // "Reached end of buffer unexpectedly".
  if (!order.transaction) {
    throw new Error("Jupiter returned no transaction — check the wallet's SOL balance covers the amount plus fees");
  }
  const vTx    = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  const signed = await wallet.signTransaction(vTx) as VersionedTransaction;
  return ultraExecute(Buffer.from(signed.serialize()).toString("base64"), order.requestId);
}

// Display-only quote preview — Ultra /order without a taker returns the
// quote alone (the old quote-api.jup.ag/v6 domain no longer resolves).
async function jupiterPreviewQuote(inputMint: string, outputMint: string, amount: number) {
  const url = new URL(`${JUP_ULTRA_BASE}/order`);
  url.searchParams.set("inputMint",   inputMint);
  url.searchParams.set("outputMint",  outputMint);
  url.searchParams.set("amount",      String(Math.floor(amount)));
  url.searchParams.set("slippageBps", String(SLIPPAGE));
  const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${JUP_API_KEY}` } });
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
  // skipPreflight: true — simulation runs against a snapshot that may lag
  // behind the just-confirmed Jupiter tx, producing a false InsufficientFunds.
  // We've already verified the balance via getTokenBalance; minimumAmountOut=0.
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function getTokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    const amount = accounts.value[0]?.account.data.parsed?.info?.tokenAmount?.amount;
    return amount ? BigInt(amount) : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

async function dbcSwap(
  conn:             Connection,
  wallet:           WalletProvider,
  poolAddress:      string,
  amountIn:         bigint,
  swapBaseForQuote: boolean,
  quoteIsT22:       boolean,
  inputMint:        PublicKey,
): Promise<string> {
  // Spend the INTENDED amount, never the whole wallet: clamp to the actual
  // balance only when the prior swap landed slightly less than estimated.
  // (Spending `actual` outright once drained a creator's entire quote
  // stack into their own curve and fully bonded it in one click.)
  const actual = await getTokenBalance(conn, wallet.publicKey, inputMint);
  if (actual <= BigInt(0)) {
    throw new Error(`Wallet holds none of the input token (${inputMint.toBase58().slice(0, 8)}…) — cannot swap`);
  }
  let safeIn = amountIn > BigInt(0) && amountIn < actual ? amountIn : actual;

  const client = DynamicBondingCurveClient.create(conn, "confirmed");

  // Buying base with quote: the curve only absorbs quote up to its migration
  // threshold — cap the input at remaining capacity or the program throws
  // 6033 "Liquidity in bonding curve is insufficient".
  if (!swapBaseForQuote) {
    const poolPk    = new PublicKey(poolAddress);
    const pool      = await client.state.getPool(poolPk);
    const threshold = await client.state.getPoolMigrationQuoteThreshold(poolPk);
    if (pool && threshold) {
      const remaining = BigInt(threshold.toString()) - BigInt(pool.poolState.quoteReserve.toString());
      if (remaining <= BigInt(0)) {
        throw new Error("This bonding curve is fully bonded — no curve liquidity left to buy");
      }
      if (safeIn > remaining) safeIn = remaining;
    }
  }

  const rawTx  = await client.pool.swap({
    owner:                wallet.publicKey,
    pool:                 new PublicKey(poolAddress),
    amountIn:             new BN(safeIn.toString()),
    minimumAmountOut:     new BN("0"), // bonding curve — output units ≠ input units
    swapBaseForQuote,
    referralTokenAccount: null,
  });
  return sendAndConfirm(conn, patchToken2022(rawTx, quoteIsT22), wallet);
}

function fmt(raw: string | number, decimals = 9) {
  return (Number(raw) / 10 ** decimals).toFixed(4);
}

export interface SwapWidgetProps {
  /** Pool A: this content's LEAK token / quote */
  leakPoolAddress:     string;
  leakMint:            string;
  /** Pool B: this content's DONTLEAK token / LEAK_content */
  dontLeakPoolAddress: string;
  dontLeakMint:        string;
  /** Chosen quote (rfreestacc | GNcib | stacccana) */
  quoteMint:           string;
  quoteDecimals?:      number;
}

type Mode = "leak" | "dontleak";

export default function SwapWidget({
  leakPoolAddress,
  leakMint,
  dontLeakPoolAddress,
  quoteMint,
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
      const q = await jupiterPreviewQuote(SOL_MINT, quoteMint, lamports);
      setLeakPreview(q.outAmount);
    } catch {
      setQuoteErr("Preview unavailable");
      setLeakPreview(null);
    }
  }, [quoteMint, quoteDecimals]);

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

      const taker = wallet.publicKey.toBase58();
      const confirmTx = async (sig: string) => {
        // Jupiter Ultra /execute returns at "processed" commitment; wait for
        // "confirmed" so the next swap's balance read sees the new tokens.
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
        await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      };

      // ── Hop 1 (both modes): SOL → quote via Jupiter ─────────────────────
      addLog("Fetching Jupiter Ultra order (SOL → quote)…");
      const order = await ultraOrder(SOL_MINT, quoteMint, lamports, taker);
      if (!order.transaction) {
        throw new Error("Jupiter found a route but no transaction for your wallet — lower the amount or top up SOL (must cover amount + fees)");
      }
      addLog(`~${fmt(lamports)} SOL → ~${fmt(order.outAmount, quoteDecimals)} quote`);
      addLog("Sign tx 1 — SOL → quote (Jupiter Ultra)");
      const sig1 = await ultraSwap(order, wallet);
      await confirmTx(sig1);
      addLog(`✓ quote confirmed  (${sig1.slice(0, 16)}…)`);

      // ── Hop 2 (both modes): quote → LEAK_content on pool A ──────────────
      const leakMintPk = new PublicKey(leakMint);
      const leakBefore = await getTokenBalance(conn, wallet.publicKey, leakMintPk);
      addLog("Sign tx 2 — quote → Leak token (pool A)");
      const sig2 = await dbcSwap(
        conn, wallet, leakPoolAddress,
        BigInt(order.outAmount), false, quoteIsT22, new PublicKey(quoteMint),
      );
      await confirmTx(sig2);
      const leakAfter    = await getTokenBalance(conn, wallet.publicKey, leakMintPk);
      const leakReceived = leakAfter - leakBefore;
      addLog(`✓ ${fmt(leakReceived.toString())} Leak received  (${sig2.slice(0, 16)}…)`);

      if (mode === "leak") {
        // Holding this content's Leak token IS the vote — pool A's unsold
        // supply just dropped, raising the reveal ratio for everyone.
        addLog("✓ Holding Leak — reveal ratio rises for everyone");
        setDone(sig2);
        return;
      }

      // ── Hop 3 (DontLeak): LEAK_content → DONTLEAK on pool B ─────────────
      if (leakReceived <= BigInt(0)) throw new Error("No Leak tokens received from pool A — cannot continue");
      addLog("Sign tx 3 — Leak → DontLeak (pool B)");
      // Pool B's quote is the content's LEAK token (Token-2022 by construction)
      const sig3 = await dbcSwap(
        conn, wallet, dontLeakPoolAddress,
        leakReceived, false, true, leakMintPk,
      );
      addLog(`✓ DontLeak received — suppression deepens  (${sig3.slice(0, 16)}…)`);
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
          <span className="text-white/30">→ quote</span>
          <span className={quoteErr ? "text-red-400/60" : "text-green-400/70"}>
            {quoteErr ?? (leakPreview ? `~${fmt(leakPreview, quoteDecimals)}` : "…")}
          </span>
        </div>
        {!isLeak && (
          <>
            <div className="flex justify-between">
              <span className="text-white/30">→ quoteMint</span>
              <span className="text-white/40">~market rate (DBC L1)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/30">→ DontLeak</span>
              <span className="text-red-400/70">~market rate (DBC L2)</span>
            </div>
          </>
        )}
        <div className="pt-1 text-white/20 text-[10px]">
          {isLeak ? "2 txs: SOL→quote (Jupiter), quote→Leak (pool A)" : "3 txs: SOL→quote, quote→Leak (pool A), Leak→DontLeak (pool B)"}
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
