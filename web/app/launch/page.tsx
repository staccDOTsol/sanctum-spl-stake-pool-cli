"use client";

import { useState, useRef } from "react";
import { Connection } from "@solana/web3.js";
import { put } from "@vercel/blob/client";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";
import { deployPool2 } from "@/lib/deploy/transactions";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";

type Step = "wallet" | "details" | "deploy" | "encrypt" | "register" | "done";

interface FormState {
  title:       string;
  description: string;
  contentType: string;
  file:        File | null;
}

// Get a client token server-side, then PUT file directly to Blob from browser.
// The file never passes through our serverless function → no 4.5 MB limit.
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

export default function LaunchPage() {
  const [step, setStep]       = useState<Step>("wallet");
  const [wallet, setWallet]   = useState<WalletProvider | null>(null);
  const [form, setForm]       = useState<FormState>({ title: "", description: "", contentType: "text", file: null });
  const [log, setLog]         = useState<string[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<{ pool2Address: string; dontLeakMint: string } | null>(null);
  const fileRef               = useRef<HTMLInputElement>(null);

  function addLog(msg: string) {
    setLog(prev => [...prev, msg]);
  }

  async function handleConnect() {
    setError(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      addLog(`Wallet connected: ${w.publicKey.toBase58().slice(0, 12)}…`);
      setStep("details");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wallet connection failed");
    }
  }

  async function handleDeploy() {
    if (!wallet) return;
    setError(null);
    setStep("deploy");
    addLog("Building Pool 2 transactions…");

    try {
      const conn = new Connection(RPC, "confirmed");

      // Content file — presign → browser PUT directly to Blob (no serverless body limit)
      let fileUrl = `https://leak.markets/content/placeholder`;
      if (form.file) {
        addLog(`Uploading ${form.file.name} (${(form.file.size / 1024).toFixed(1)} KB)…`);
        const pathname = `content/${Date.now()}-${form.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fileUrl = await blobUpload(pathname, form.file);
        addLog(`Uploaded: ${fileUrl.slice(0, 60)}…`);
      }

      // Metadata JSON — built in browser, uploaded the same way
      const slug   = form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
      const symbol = ("DL" + slug.replace(/-/g, "").toUpperCase()).slice(0, 8);
      const metaJson = JSON.stringify({
        name:        `DontLeak: ${form.title}`,
        symbol,
        description: form.description,
        image:       fileUrl,
        external_url: "https://leak.markets",
        attributes: [{ trait_type: "Protocol", value: "leak.markets" }],
      });
      const metaFile = new File([metaJson], "metadata.json", { type: "application/json" });
      const metaUrl = await blobUpload(`token-metadata/${slug}-${Date.now()}.json`, metaFile);
      addLog(`Metadata JSON: ${metaUrl.slice(0, 60)}…`);

      addLog("Deploying Pool 2 config (tx 1/2)…");
      const deployResult = await deployPool2(conn, wallet, {
        name:   `DontLeak: ${form.title}`,
        symbol,
        uri:    metaUrl,
      });

      setResult({ pool2Address: deployResult.pool2Address, dontLeakMint: deployResult.dontLeakMint });
      addLog(`✓ Pool 2 deployed: ${deployResult.sig.slice(0, 20)}…`);
      addLog(`  DontLeak mint:   ${deployResult.dontLeakMint}`);
      addLog(`  Pool address:    ${deployResult.pool2Address}`);

      setStep("encrypt");
      await handleEncryptAndRegister(deployResult, fileUrl, metaUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deployment failed");
      setStep("details");
    }
  }

  async function handleEncryptAndRegister(
    deployResult: { pool2Address: string; dontLeakMint: string; sig: string },
    fileUrl: string,
    metaUrl: string,
  ) {
    addLog("Registering content…");
    try {
      const totalBytes = form.file?.size ?? 0;
      const regRes = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:               form.title,
          description:         form.description,
          contentType:         form.contentType,
          leakPoolAddress:     "ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX",
          dontLeakPoolAddress: deployResult.pool2Address,
          leakMint:            "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS",
          dontLeakMint:        deployResult.dontLeakMint,
          totalBytes,
          encryptedPayloadUrl: fileUrl,
          metadataUrl:         metaUrl,
          creator:             wallet!.publicKey.toBase58(),
        }),
      });
      if (!regRes.ok) {
        const { error: regErr } = await regRes.json().catch(() => ({ error: "Registration failed" }));
        throw new Error(regErr);
      }
      addLog("✓ Content registered and live!");
      setStep("done");
    } catch (e: unknown) {
      addLog(`Warning: registration failed — ${e instanceof Error ? e.message : "unknown"}`);
      setStep("done");
    }
  }

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
        <p className="text-white/50">
          Encrypt content and let the market decide how much gets revealed.
        </p>
      </div>

      <div className="flex gap-1 mb-8">
        {(["wallet", "details", "deploy", "done"] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              ["wallet", "details", "deploy", "encrypt", "register", "done"].indexOf(step) >= i
                ? "bg-green-500"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {step === "wallet" && (
        <div className="space-y-4">
          <p className="text-white/70 text-sm">
            Connect your Solana wallet (Phantom or Solflare) to get started.
            You{"'"}ll pay gas for two transactions.
          </p>
          <button
            onClick={handleConnect}
            className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {step === "details" && (
        <form
          onSubmit={e => { e.preventDefault(); handleDeploy(); }}
          className="space-y-5"
        >
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
            <label className="block text-sm font-medium text-white/70 mb-1.5">Content type</label>
            <select
              value={form.contentType}
              onChange={e => setForm(f => ({ ...f, contentType: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-green-500/40"
            >
              <option value="text">Text / Document</option>
              <option value="jpeg">Image (JPEG)</option>
              <option value="png">Image (PNG)</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">
              File <span className="text-white/30">(optional — will be encrypted)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] ?? null }))}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full py-6 rounded-xl border-2 border-dashed border-white/10 hover:border-green-500/30 text-white/40 hover:text-white/60 text-sm transition-colors"
            >
              {form.file ? `📄 ${form.file.name} (${(form.file.size / 1024).toFixed(1)} KB)` : "Click to choose file"}
            </button>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors"
          >
            Deploy Pool 2 + Encrypt →
          </button>
        </form>
      )}

      {(step === "deploy" || step === "encrypt" || step === "register") && (
        <div className="space-y-3">
          <p className="text-white/50 text-sm">
            Follow wallet prompts to sign transactions…
          </p>
          <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-1.5 font-mono text-xs text-green-400/80 min-h-32 max-h-64 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
            <div className="inline-block w-1.5 h-3 bg-green-400/60 animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-green-500/8 border border-green-500/20">
            <div className="text-green-400 font-bold text-lg mb-1">🎉 Content deployed!</div>
            <p className="text-white/60 text-sm">
              Your DontLeak pool is live. The market can now vote on whether your content
              gets revealed.
            </p>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between px-3 py-2 rounded-lg bg-white/5">
              <span className="text-white/40">DontLeak mint</span>
              <span className="text-white/80">{result.dontLeakMint.slice(0, 20)}…</span>
            </div>
            <div className="flex justify-between px-3 py-2 rounded-lg bg-white/5">
              <span className="text-white/40">Pool 2 address</span>
              <span className="text-white/80">{result.pool2Address.slice(0, 20)}…</span>
            </div>
          </div>

          {log.length > 0 && (
            <div className="p-4 rounded-xl bg-white/3 border border-white/8 space-y-1 font-mono text-xs text-green-400/60 max-h-48 overflow-y-auto">
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}

          <a
            href="/explore"
            className="block text-center py-3 rounded-xl bg-green-500 hover:bg-green-400 text-black font-bold text-sm transition-colors"
          >
            View on Explore →
          </a>
        </div>
      )}
    </div>
  );
}
