"use client";

import { useState } from "react";
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";

interface ConfigResult {
  type:    "stable" | "meme";
  address: string;
  envVar:  string;
  sig:     string;
}

async function deployConfig(
  conn: Connection,
  wallet: WalletProvider,
  configType: "stable" | "meme",
): Promise<ConfigResult> {
  const configKp = Keypair.generate();

  const res = await fetch("/api/admin/config-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payer:        wallet.publicKey.toBase58(),
      configType,
      configPubkey: configKp.publicKey.toBase58(),
    }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "API error" }));
    throw new Error(error ?? "Failed to build config tx");
  }

  const { txBase64, blockhash, lastValidBlockHeight } = await res.json();

  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(configKp);

  const signed = await wallet.signTransaction(tx) as Transaction;
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    type:    configType,
    address: configKp.publicKey.toBase58(),
    envVar:  configType === "stable" ? "STABLE_POOL_CONFIG" : "MEME_POOL_CONFIG",
    sig,
  };
}

export default function SetupConfigsPage() {
  const [wallet, setWallet]   = useState<WalletProvider | null>(null);
  const [results, setResults] = useState<ConfigResult[]>([]);
  const [log, setLog]         = useState<string[]>([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  async function handleConnect() {
    try { setWallet(await connectWallet()); }
    catch (e) { setError(e instanceof Error ? e.message : "Wallet failed"); }
  }

  async function handleDeploy(configType: "stable" | "meme") {
    if (!wallet) return;
    setError(null);
    setBusy(true);
    const conn = new Connection(RPC, "confirmed");
    try {
      addLog(`Deploying ${configType} config…`);
      const result = await deployConfig(conn, wallet, configType);
      setResults(prev => [...prev.filter(r => r.type !== configType), result]);
      addLog(`✓ ${configType}: ${result.address}`);
      addLog(`  Set env var: ${result.envVar}=${result.address}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-yellow-500/20 bg-yellow-500/8 mb-4">
          <span className="text-xs font-mono text-yellow-400/80 uppercase tracking-widest">
            Admin · One-time setup
          </span>
        </div>
        <h1 className="text-3xl font-black text-white mb-2">Deploy L1 Pool Configs</h1>
        <p className="text-white/50 text-sm">
          Creates the two shared DBC configs that all content pools bond under.
          Platform wallet is feeClaimer on both — run this ONCE on mainnet.
        </p>
      </div>

      {!wallet ? (
        <button onClick={handleConnect}
          className="w-full py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm transition-colors">
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/8 text-xs text-white/50 font-mono">
            {wallet.publicKey.toBase58()}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {(["stable", "meme"] as const).map(t => {
              const done = results.find(r => r.type === t);
              return (
                <button
                  key={t}
                  onClick={() => handleDeploy(t)}
                  disabled={busy || !!done}
                  className={`py-4 rounded-xl font-bold text-sm transition-colors disabled:opacity-50 ${
                    done
                      ? "bg-green-500/10 border border-green-500/30 text-green-400 cursor-default"
                      : t === "stable"
                        ? "bg-green-500 hover:bg-green-400 text-black"
                        : "bg-purple-500 hover:bg-purple-400 text-white"
                  }`}
                >
                  {done ? `✓ ${t}` : `Deploy ${t} config`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {log.length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/8 space-y-1 font-mono text-xs text-green-400/70 max-h-48 overflow-y-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <p className="text-white/60 text-sm font-medium">Add these to your Vercel environment variables:</p>
          {results.map(r => (
            <div key={r.type} className="p-4 rounded-xl bg-white/5 border border-white/10 font-mono text-xs space-y-1">
              <div className="text-yellow-400">{r.envVar}</div>
              <div className="text-white/80 break-all">{r.address}</div>
              <div className="text-white/30 pt-1">
                tx: <a href={`https://solscan.io/tx/${r.sig}`} target="_blank" rel="noopener noreferrer" className="underline">{r.sig.slice(0,20)}…</a>
              </div>
            </div>
          ))}
          <p className="text-white/40 text-xs">
            Also set <span className="text-white/60">STABLE_L1_POOL</span> and <span className="text-white/60">MEME_L1_POOL</span> to
            the pool addresses once you create the first pools under each config.
          </p>
        </div>
      )}
    </div>
  );
}
