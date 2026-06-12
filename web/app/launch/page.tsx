"use client";

import { useState, useRef } from "react";
import { Connection } from "@solana/web3.js";
import { put } from "@vercel/blob/client";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";
import { deployCurve, prepareDeployment, QUOTE_MINT_BY_TYPE, type PoolTypeChoice } from "@/lib/deploy/transactions";

const RPC = "https://mainnet.helius-rpc.com/?api-key=89a5704a-97ad-4c43-9be4-f04dc03a6b34";

type Step = "wallet" | "pooltype" | "details" | "deploy" | "done";

interface FormState {
  title:       string;
  description: string;
  contentType: string;
  file:        File | null;
}

// Detect the real MIME type of an upload: browser-provided type first,
// extension fallback for browsers that leave file.type empty.
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", mp3: "audio/mpeg", wav: "audio/wav",
  m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", mp4: "video/mp4",
  webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  txt: "text/plain", md: "text/markdown", json: "application/json", pdf: "application/pdf",
};
function detectMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

async function blobUpload(pathname: string, file: File): Promise<string> {
  const res = await fetch("/api/blob/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname, contentType: file.type || "application/octet-stream" }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "Presign failed" }));
    throw new Error(error);
  }
  const { clientToken } = await res.json();
  const blob = await put(pathname, file, { access: "public", token: clientToken });
  return blob.url;
}

// L1 quote tokens — content pools quote against these (not LEAK directly).
// Buyers: SOL → LEAK (Jupiter) → quoteMint (DBC L1) → DontLeak (DBC L2)
const POOL_TYPES: { id: PoolTypeChoice; label: string; sub: string; accent: string }[] = [
  {
    id:     "stable",
    label:  "rfreestacc",
    sub:    "Quote rfreestacc → bonds to LEAK. Yield-bearing, progressive decryption.",
    accent: "green",
  },
  {
    id:     "meme",
    label:  "Meme Launch",
    sub:    "Quote GNcibpKH → bonds to LEAK. 1B market cap to fully bond.",
    accent: "purple",
  },
  {
    id:     "stacccana",
    label:  "$stacccana",
    sub:    "Quote $stacccana (73edX6xo…pump) → bonds to LEAK. 1B market cap to fully bond.",
    accent: "purple",
  },
];

export default function LaunchPage() {
  const [step, setStep]           = useState<Step>("wallet");
  const [wallet, setWallet]       = useState<WalletProvider | null>(null);
  const [poolType, setPoolType]   = useState<PoolTypeChoice>("stable");
  const [form, setForm]           = useState<FormState>({ title: "", description: "", contentType: "text", file: null });
  const [log, setLog]             = useState<string[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<{ pool2Address: string; dontLeakMint: string } | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  function addLog(msg: string) { setLog(prev => [...prev, msg]); }

  async function handleConnect() {
    setError(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      addLog(`Wallet connected: ${w.publicKey.toBase58().slice(0, 12)}…`);
      setStep("pooltype");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wallet connection failed");
    }
  }

  async function handleDeploy() {
    if (!wallet) return;
    setError(null);
    setStep("deploy");
    addLog("Preparing two-pool launch…");

    try {
      const conn = new Connection(RPC, "confirmed");

      // All keypairs + BOTH pool addresses first: encryption binds to this
      // content's own vault pair, derivable before anything is broadcast.
      const prepared = await prepareDeployment(poolType);
      addLog(`Leak pool:     ${prepared.leakPool.slice(0, 12)}…`);
      addLog(`DontLeak pool: ${prepared.dontLeakPool.slice(0, 12)}…`);

      let fileUrl = "";
      if (form.file) {
        addLog(`Encrypting ${form.file.name} in tiered chunks (Lit TEE)…`);
        const fd = new FormData();
        fd.append("file", form.file);
        fd.append("leakPool", prepared.leakPool);
        fd.append("leakMint", prepared.leakMintKp.publicKey.toBase58());
        fd.append("dontLeakPool", prepared.dontLeakPool);
        fd.append("baseMint", prepared.dontLeakKp.publicKey.toBase58());
        const encRes = await fetch("/api/lit/encrypt", { method: "POST", body: fd });
        if (!encRes.ok) {
          const { error } = await encRes.json().catch(() => ({ error: "Encryption failed" }));
          throw new Error(error);
        }
        const encrypted   = await encRes.json();
        addLog(`✓ ${encrypted.chunks?.length ?? 1} encrypted tiers, ratio enforced by Lit`);
        const payloadJson = JSON.stringify(encrypted);
        const payloadFile = new File([payloadJson], "encrypted-payload.json", { type: "application/json" });
        const pathname    = `content/${Date.now()}-${form.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.enc.json`;
        fileUrl = await blobUpload(pathname, payloadFile);
        addLog(`Encrypted & uploaded: ${fileUrl.slice(0, 60)}…`);
      }

      const slug       = form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
      const totalBytes = form.file?.size ?? 0;

      // Token metadata for BOTH tokens
      const mkMeta = async (kind: "Leak" | "DontLeak", symbol: string) => {
        const metaJson = JSON.stringify({
          name:         `${kind}: ${form.title}`,
          symbol,
          description:  form.description,
          image:        fileUrl,
          external_url: "https://leak.markets",
          attributes: [
            { trait_type: "Protocol",            value: "leak.markets" },
            { trait_type: "Side",                value: kind },
            { trait_type: "PoolType",            value: poolType },
            { trait_type: "ContentType",         value: form.contentType },
            { trait_type: "TotalBytes",          value: totalBytes },
            { trait_type: "LeakPool",            value: prepared.leakPool },
            { trait_type: "LeakMint",            value: prepared.leakMintKp.publicKey.toBase58() },
            { trait_type: "DontLeakPool",        value: prepared.dontLeakPool },
            { trait_type: "QuoteMint",           value: prepared.quoteMint },
            { trait_type: "EncryptedContentUrl", value: fileUrl },
            { trait_type: "Creator",             value: wallet.publicKey.toBase58() },
          ],
        });
        const metaFile = new File([metaJson], "metadata.json", { type: "application/json" });
        return blobUpload(`token-metadata/${slug}-${kind.toLowerCase()}-${Date.now()}.json`, metaFile);
      };

      const symBase    = slug.replace(/-/g, "").toUpperCase();
      const leakSym    = ("L"  + symBase).slice(0, 8);
      const dlSym      = ("DL" + symBase).slice(0, 8);
      const [leakMeta, dlMeta] = await Promise.all([mkMeta("Leak", leakSym), mkMeta("DontLeak", dlSym)]);
      addLog("Metadata uploaded for both tokens");

      // Pool A: LEAK_content / quote
      addLog("Deploying Leak pool (tx 1/2)…");
      const poolA = await deployCurve(conn, wallet, {
        configKp:  prepared.leakConfigKp,
        baseKp:    prepared.leakMintKp,
        quoteMint: prepared.quoteMint,
        name:      `Leak: ${form.title}`,
        symbol:    leakSym,
        uri:       leakMeta,
        curve:     poolType === "stable" ? "stable" : "meme",
      });
      addLog(`✓ Leak pool live  (${poolA.sig.slice(0, 16)}…)`);

      // Pool B: DONTLEAK / LEAK_content — quote mint now exists on-chain
      addLog("Deploying DontLeak pool (tx 2/2)…");
      const poolB = await deployCurve(conn, wallet, {
        configKp:  prepared.dlConfigKp,
        baseKp:    prepared.dontLeakKp,
        quoteMint: prepared.leakMintKp.publicKey.toBase58(),
        name:      `DontLeak: ${form.title}`,
        symbol:    dlSym,
        uri:       dlMeta,
        curve:     "stable",
      });
      addLog(`✓ DontLeak pool live  (${poolB.sig.slice(0, 16)}…)`);

      setResult({ pool2Address: poolB.pool, dontLeakMint: poolB.mint });
      await handleRegister(prepared, fileUrl, dlMeta, totalBytes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deployment failed");
      setStep("details");
    }
  }

  async function handleRegister(
    prepared: Awaited<ReturnType<typeof prepareDeployment>>,
    fileUrl: string,
    metaUrl: string,
    totalBytes: number,
  ) {
    addLog("Registering content…");
    try {
      const regRes = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:               form.title,
          description:         form.description,
          contentType:         form.contentType,
          leakPoolAddress:     prepared.leakPool,
          dontLeakPoolAddress: prepared.dontLeakPool,
          leakMint:            prepared.leakMintKp.publicKey.toBase58(),
          dontLeakMint:        prepared.dontLeakKp.publicKey.toBase58(),
          quoteMint:           prepared.quoteMint,
          poolType,
          totalBytes,
          encryptedPayloadUrl: fileUrl,
          metadataUrl:         metaUrl,
          creator:             wallet!.publicKey.toBase58(),
        }),
      });
      if (!regRes.ok) throw new Error((await regRes.json().catch(() => ({ error: "Registration failed" }))).error);
      addLog("✓ Content registered and live!");
      setStep("done");
    } catch (e: unknown) {
      addLog(`Warning: registration failed — ${e instanceof Error ? e.message : "unknown"}`);
      setStep("done");
    }
  }

  const chosenType = POOL_TYPES.find(t => t.id === poolType)!;
  const stepIndex  = ["wallet", "pooltype", "details", "deploy", "done"].indexOf(step);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/20 bg-green-500/8 mb-4">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-mono text-green-400/80 uppercase tracking-widest">
            leak.markets · Launch wizard
          </span>
        </div>
        <h1 className="text-4xl font-black text-white mb-2">Deploy a Leak</h1>
        <p className="text-white/50">Encrypt content and let the market decide how much gets revealed.</p>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-8">
        {["wallet", "pooltype", "details", "deploy", "done"].map((s, i) => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${stepIndex >= i ? "bg-green-500" : "bg-white/10"}`} />
        ))}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* Step: wallet */}
      {step === "wallet" && (
        <div className="space-y-4">
          <p className="text-white/70 text-sm">Connect your Solana wallet (Phantom or Solflare) to get started.</p>
          <button onClick={handleConnect} className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors">
            Connect Wallet
          </button>
        </div>
      )}

      {/* Step: pool type */}
      {step === "pooltype" && (
        <div className="space-y-4">
          <p className="text-white/60 text-sm mb-2">Choose how your content bonds to the market.</p>
          <div className="grid grid-cols-1 gap-3">
            {POOL_TYPES.map(pt => (
              <button
                key={pt.id}
                onClick={() => setPoolType(pt.id)}
                className={`text-left p-4 rounded-xl border-2 transition-colors ${
                  poolType === pt.id
                    ? pt.accent === "purple"
                      ? "border-purple-500/60 bg-purple-500/10"
                      : "border-green-500/60 bg-green-500/10"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <div className={`font-bold text-sm mb-0.5 ${
                  poolType === pt.id
                    ? pt.accent === "purple" ? "text-purple-300" : "text-green-400"
                    : "text-white/70"
                }`}>
                  {pt.label}
                </div>
                <div className="text-xs text-white/40">{pt.sub}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep("details")}
            className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors"
          >
            Continue →
          </button>
        </div>
      )}

      {/* Step: details */}
      {step === "details" && (
        <form onSubmit={e => { e.preventDefault(); handleDeploy(); }} className="space-y-5">
          <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between ${
            chosenType.accent === "purple" ? "bg-purple-500/8 border-purple-500/20 text-purple-400/80" : "bg-green-500/8 border-green-500/20 text-green-400/80"
          }`}>
            <span>{chosenType.label}</span>
            <button type="button" onClick={() => setStep("pooltype")} className="text-white/30 hover:text-white/60 text-[10px]">change</button>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/8 text-xs text-white/50 font-mono">
            {wallet?.publicKey.toBase58()}
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">Title</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Unreleased Track #001"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm focus:outline-none focus:border-green-500/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What is this? Why might the market want to know?"
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 text-sm resize-none focus:outline-none focus:border-green-500/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">
              File <span className="text-white/30">(optional — will be encrypted)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              onChange={e => {
                const file = e.target.files?.[0] ?? null;
                // contentType auto-detected from the upload; "text" when no file
                setForm(f => ({ ...f, file, contentType: file ? detectMime(file) : "text" }));
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full py-6 rounded-xl border-2 border-dashed border-white/10 hover:border-green-500/30 text-white/40 hover:text-white/60 text-sm transition-colors"
            >
              {form.file ? `${form.file.name} (${(form.file.size / 1024).toFixed(1)} KB)` : "Click to choose file"}
            </button>
            {form.file && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/8 text-xs font-mono text-white/50">
                detected type: <span className="text-green-400/80">{form.contentType}</span>
              </div>
            )}
          </div>

          <button type="submit" className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors">
            Deploy {chosenType.label} Pool →
          </button>
        </form>
      )}

      {step === "deploy" && (
        <div className="space-y-3">
          <p className="text-white/50 text-sm">Follow wallet prompts to sign transactions…</p>
          <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-1.5 font-mono text-xs text-green-400/80 min-h-32 max-h-64 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
            <div className="inline-block w-1.5 h-3 bg-green-400/60 animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-green-500/8 border border-green-500/20">
            <div className="text-green-400 font-bold text-lg mb-1">Content deployed!</div>
            <p className="text-white/60 text-sm">Your pool is live. The market can now vote on whether your content gets revealed.</p>
          </div>
          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between px-3 py-2 rounded-lg bg-white/5">
              <span className="text-white/40">Pool type</span>
              <span className="text-white/80">{chosenType.label}</span>
            </div>
            <div className="flex justify-between px-3 py-2 rounded-lg bg-white/5">
              <span className="text-white/40">DontLeak mint</span>
              <span className="text-white/80">{result.dontLeakMint.slice(0, 20)}…</span>
            </div>
            <div className="flex justify-between px-3 py-2 rounded-lg bg-white/5">
              <span className="text-white/40">Pool address</span>
              <span className="text-white/80">{result.pool2Address.slice(0, 20)}…</span>
            </div>
          </div>
          {log.length > 0 && (
            <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-1 font-mono text-xs text-green-400/60 max-h-48 overflow-y-auto">
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          <a href="/explore" className="block text-center py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors">
            View on Explore →
          </a>
        </div>
      )}
    </div>
  );
}
