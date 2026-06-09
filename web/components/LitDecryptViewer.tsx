"use client";

/**
 * Progressively decrypts content using Lit Protocol, revealing
 * Math.floor(ratio * totalBytes) bytes proportional to the market ratio.
 *
 * Access: viewer must hold ≥1 LEAK token on Solana.
 * "Don't store OG facts": the encrypted payload URL points to a JSON blob
 * containing only { ciphertext, dataToEncryptHash, contentType }, never plaintext.
 */
import { useState, useEffect } from "react";
import type { EncryptedPayload } from "@/lib/lit";

interface Props {
  encryptedPayloadUrl?: string;
  contentType: string;
  ratio:       number; // 0–1 from pool reserves
  totalBytes:  number;
}

type DecryptState = "idle" | "connecting" | "signing" | "decrypting" | "done" | "error";

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

export default function LitDecryptViewer({ encryptedPayloadUrl, contentType, ratio, totalBytes }: Props) {
  const [state, setState]         = useState<DecryptState>("idle");
  const [error, setError]         = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<Uint8Array | null>(null);
  const [dataUrl, setDataUrl]     = useState<string | null>(null);

  const revealedBytes = Math.floor(ratio * totalBytes);
  const leakPct       = Math.round(ratio * 100);

  // Build preview once decrypted
  useEffect(() => {
    if (!decrypted) return;
    const slice = decrypted.slice(0, revealedBytes);
    if (contentType.includes("text") || contentType === "text") {
      // text/document: show as UTF-8
      setDataUrl(null);
    } else {
      // image/audio/video: create a blob URL for the revealed slice
      const blob = new Blob([slice], { type: contentType });
      const url  = URL.createObjectURL(blob);
      setDataUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [decrypted, revealedBytes, contentType]);

  async function handleDecrypt() {
    if (!encryptedPayloadUrl) { setError("No encrypted content URL"); return; }

    setState("connecting");
    setError(null);
    try {
      // Load Lit dynamically (SSR-safe)
      let litModule: Awaited<typeof import("@/lib/lit")>;
      try {
        litModule = await import("@/lib/lit");
      } catch (e) {
        throw new Error(`Lit SDK failed to load: ${e instanceof Error ? e.message : e}`);
      }
      const { getLitClient: _connect, decryptBytes, signForLit } = litModule;

      try {
        await _connect();
      } catch (e) {
        throw new Error(`Lit network unreachable: ${e instanceof Error ? e.message : e}`);
      }

      // Fetch the encrypted payload JSON from Blob
      let payload: EncryptedPayload;
      try {
        const res = await fetch(encryptedPayloadUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json() as EncryptedPayload;
      } catch (e) {
        throw new Error(`Could not fetch encrypted payload: ${e instanceof Error ? e.message : e}`);
      }

      if (!payload.ciphertext || !payload.dataToEncryptHash) {
        // Backward-compat: URL might be a raw file (pre-Lit content)
        const raw = await fetch(encryptedPayloadUrl, { cache: "no-store" });
        const buf = await raw.arrayBuffer();
        setDecrypted(new Uint8Array(buf));
        setState("done");
        return;
      }

      // Get authSig from wallet
      setState("signing");
      const solana = (window as unknown as { solana?: { publicKey?: { toBase58?: () => string } } }).solana;
      const pubkey = solana?.publicKey?.toBase58?.();
      if (!pubkey) throw new Error("Connect your Solana wallet first");

      let authSig: object;
      try {
        authSig = await signForLit(pubkey);
      } catch (e) {
        throw new Error(`Wallet signing failed: ${e instanceof Error ? e.message : e}`);
      }

      // Decrypt via Lit
      setState("decrypting");
      let bytes: Uint8Array;
      try {
        bytes = await decryptBytes(payload, authSig);
      } catch (e) {
        throw new Error(`Lit decryption failed: ${e instanceof Error ? e.message : e}`);
      }
      setDecrypted(bytes);
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Decryption failed");
      setState("error");
    }
  }

  // Revealed text preview (proportional to ratio)
  const textPreview = (() => {
    if (!decrypted || state !== "done") return null;
    if (!contentType.includes("text") && contentType !== "text") return null;
    const full = new TextDecoder().decode(decrypted);
    return full.slice(0, revealedBytes);
  })();

  if (!encryptedPayloadUrl) {
    return (
      <div className="flex items-center justify-center h-32 text-white/20 text-xs font-mono">
        No content uploaded
      </div>
    );
  }

  if (state === "done" && decrypted) {
    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-mono text-green-400/60">
            {leakPct}% revealed · {formatBytes(revealedBytes)} / {formatBytes(totalBytes)}
          </span>
          {ratio < 1 && (
            <span className="text-xs text-white/30 font-mono">Buy Leak to reveal more →</span>
          )}
        </div>

        {/* Content */}
        {textPreview !== null ? (
          <div className="relative">
            <pre className="p-4 rounded-xl bg-white/3 border border-white/8 text-white/70 text-xs font-mono leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap break-words">
              {textPreview || <span className="text-white/20">[no content revealed yet — buy Leak]</span>}
            </pre>
            {ratio < 1 && (
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0c0c10] to-transparent rounded-b-xl pointer-events-none" />
            )}
          </div>
        ) : dataUrl ? (
          <div className="rounded-xl overflow-hidden border border-white/8">
            {contentType.includes("image") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt="Decrypted content" className="w-full max-h-96 object-contain" />
            ) : contentType.includes("audio") ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={dataUrl} className="w-full p-3" />
            ) : contentType.includes("video") ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video controls src={dataUrl} className="w-full max-h-64" />
            ) : (
              <a href={dataUrl} download className="block p-4 text-green-400 text-sm font-mono underline">
                Download decrypted file ({formatBytes(revealedBytes)})
              </a>
            )}
          </div>
        ) : (
          <div className="p-4 text-white/30 text-xs font-mono">
            {formatBytes(revealedBytes)} decrypted · unsupported preview type
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 p-5 space-y-3">
      {/* Encrypted noise preview */}
      <div
        className="h-24 rounded-lg overflow-hidden flex items-center justify-center"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            rgba(255,255,255,0.02),
            rgba(255,255,255,0.02) 2px,
            transparent 2px,
            transparent 8px
          )`,
        }}
      >
        <span className="text-white/15 font-mono text-xs select-none tracking-widest">
          ██ ENCRYPTED · {formatBytes(totalBytes)} ██
        </span>
      </div>

      {/* State indicator */}
      <div className="text-xs font-mono text-white/40 text-center">
        {state === "idle"      && `${leakPct}% revealed — hold LEAK to decrypt`}
        {state === "connecting" && "Connecting to Lit Protocol…"}
        {state === "signing"   && "Sign message in wallet to authorize…"}
        {state === "decrypting" && "Decrypting with Lit TEE…"}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      <button
        onClick={handleDecrypt}
        disabled={state !== "idle" && state !== "error"}
        className="w-full py-2.5 rounded-xl bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 text-green-400 text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {state === "idle" || state === "error"
          ? "Decrypt with Lit Protocol →"
          : state === "connecting"  ? "Connecting…"
          : state === "signing"     ? "Waiting for signature…"
          : "Decrypting…"}
      </button>

      <p className="text-center text-[10px] text-white/20 font-mono">
        Requires ≥1 LEAK token · powered by Lit Protocol
      </p>
    </div>
  );
}
