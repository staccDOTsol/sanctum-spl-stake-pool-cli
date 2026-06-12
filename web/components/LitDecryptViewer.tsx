"use client";

/**
 * Progressive decryption viewer.
 *
 * Tiered (v2) payloads: the content is encrypted in K chunks behind a
 * threshold ladder (hold LEAK + L1/L2 vault thresholds) that the LIT NODES
 * evaluate against live chain state — the server returns only the chunks the
 * market currently allows. What you see here is enforced, not cosmetic.
 *
 * Legacy (v1) payloads: single ciphertext gated on holding LEAK; the ratio
 * only slices the display client-side (old behavior, kept for old content).
 */
import { useState, useEffect } from "react";
import { litAuthMessage, makeAuthSig, isTieredPayload, type AnyPayload } from "@/lib/litConditions";
import { connectWallet, type WalletProvider } from "@/lib/deploy/wallet";

interface Props {
  encryptedPayloadUrl?: string;
  contentType: string;
  ratio:       number; // 0–1 from pool reserves
  totalBytes:  number;
}

type DecryptState = "idle" | "connecting" | "signing" | "decrypting" | "done" | "error";

interface TierStatus { index: number; unlocked: boolean; data?: string }

function formatBytes(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

/** Map a MIME type or legacy form value ("png", "audio", …) to a render kind. */
function contentKind(type: string): "text" | "image" | "audio" | "video" | "other" {
  const t = type.toLowerCase();
  if (t.includes("text") || t === "json" || t.includes("document")) return "text";
  if (t.includes("image") || t === "png" || t === "jpeg" || t === "jpg" || t === "gif" || t === "webp") return "image";
  if (t.includes("audio")) return "audio";
  if (t.includes("video")) return "video";
  return "other";
}

export default function LitDecryptViewer({ encryptedPayloadUrl, contentType, ratio, totalBytes }: Props) {
  const [state, setState]         = useState<DecryptState>("idle");
  const [error, setError]         = useState<string | null>(null);
  const [decrypted, setDecrypted] = useState<Uint8Array | null>(null);
  const [dataUrl, setDataUrl]     = useState<string | null>(null);
  const [imgBroken, setImgBroken] = useState(false);
  // Real MIME type from the encrypted payload (the prop may be a legacy
  // form value like "png"); set once the payload JSON is fetched.
  const [mime, setMime]           = useState<string | null>(null);
  // Tiered payloads: per-chunk lock state from the Lit nodes
  const [tiers, setTiers]         = useState<TierStatus[] | null>(null);
  // image-strips mode: object URLs per strip (null = locked)
  const [stripUrls, setStripUrls] = useState<(string | null)[] | null>(null);

  const isTiered = tiers !== null;
  // Tiered: the unlocked prefix IS the revealed amount (Lit-enforced).
  // Legacy: ratio slices the display client-side.
  const revealedBytes = isTiered
    ? (decrypted?.length ?? 0)
    : Math.floor(ratio * totalBytes);
  const leakPct = isTiered
    ? Math.round(totalBytes > 0 ? (revealedBytes / totalBytes) * 100 : 0)
    : Math.round(ratio * 100);
  const effectiveType = mime ?? contentType;
  const kind          = contentKind(effectiveType);

  // Build preview once decrypted
  useEffect(() => {
    if (!decrypted) return;
    setImgBroken(false);
    const slice = decrypted.slice(0, revealedBytes);
    if (kind === "text") {
      // text/document: show as UTF-8
      setDataUrl(null);
    } else {
      // image/audio/video: create a blob URL for the revealed slice
      const blob = new Blob([slice], { type: effectiveType });
      const url  = URL.createObjectURL(blob);
      setDataUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [decrypted, revealedBytes, kind, effectiveType]);

  async function handleDecrypt() {
    if (!encryptedPayloadUrl) { setError("No encrypted content URL"); return; }

    setState("connecting");
    setError(null);
    try {
      // 1. Fetch the encrypted payload JSON from Blob
      let payload: AnyPayload;
      try {
        const res = await fetch(encryptedPayloadUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json() as AnyPayload;
      } catch (e) {
        throw new Error(`Could not fetch encrypted payload: ${e instanceof Error ? e.message : e}`);
      }

      const tiered = isTieredPayload(payload);
      if (!tiered && !("ciphertext" in payload && payload.ciphertext && payload.dataToEncryptHash)) {
        // Backward-compat: raw file (pre-Lit content) — show directly
        const raw = await fetch(encryptedPayloadUrl, { cache: "no-store" });
        const buf = await raw.arrayBuffer();
        setDecrypted(new Uint8Array(buf));
        setState("done");
        return;
      }
      if (payload.contentType) setMime(payload.contentType);

      // 2. Sign auth message browser-side (wallet stays on device).
      // connectWallet handles Phantom and Solflare (incl. Solflare's delayed
      // publicKey population) and prompts the connect dialog if needed.
      setState("signing");
      let wallet: WalletProvider;
      try {
        wallet = await connectWallet();
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Connect your Solana wallet first");
      }
      const pubkey = wallet.publicKey.toBase58();

      // Lit nodes verify an ed25519 signature (hex) over the canonical body
      const message  = litAuthMessage();
      let sigBytes: Uint8Array;
      try {
        sigBytes = await wallet.signMessage(new TextEncoder().encode(message));
      } catch (e) {
        throw new Error(`Wallet signing failed: ${e instanceof Error ? e.message : e}`);
      }
      const authSig = makeAuthSig(pubkey, message, sigBytes);

      // 3. Server-side decryption — avoids browser Lit SDK failures on mobile
      setState("decrypting");
      const body = tiered
        ? JSON.stringify({ payload, authSig })
        : JSON.stringify({
            ciphertext:        (payload as { ciphertext: string }).ciphertext,
            dataToEncryptHash: (payload as { dataToEncryptHash: string }).dataToEncryptHash,
            contentType:       payload.contentType,
            authSig,
          });
      let decryptRes: Response;
      try {
        decryptRes = await fetch("/api/lit/decrypt", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch (e) {
        throw new Error(`Decrypt request failed: ${e instanceof Error ? e.message : e}`);
      }

      if (!decryptRes.ok) {
        const { error } = await decryptRes.json().catch(() => ({ error: `HTTP ${decryptRes.status}` }));
        if (decryptRes.status === 403) throw new Error("Access denied — you need LEAK tokens");
        throw new Error(`Decryption failed: ${error}`);
      }

      const result = await decryptRes.json() as {
        data: string;
        mode?: "bytes" | "image-strips";
        chunks?: TierStatus[];
        unlockedBytes?: number;
      };
      setDecrypted(new Uint8Array(Buffer.from(result.data, "base64")));
      setTiers(result.chunks ?? null);
      if (result.mode === "image-strips" && result.chunks) {
        const mimeType = payload.contentType || "image/png";
        setStripUrls(result.chunks.map((c) =>
          c.unlocked && c.data
            ? URL.createObjectURL(new Blob([Buffer.from(c.data, "base64")], { type: mimeType }))
            : null,
        ));
      } else {
        setStripUrls(null);
      }
      setState("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Decryption failed");
      setState("error");
    }
  }

  // Revealed text preview
  const textPreview = (() => {
    if (!decrypted || state !== "done") return null;
    if (kind !== "text") return null;
    const full = new TextDecoder().decode(decrypted);
    return full.slice(0, revealedBytes);
  })();

  // Tier ladder bar: one segment per chunk, green = unlocked by the market
  const tierBar = isTiered && tiers && tiers.length > 0 && (
    <div className="flex gap-0.5" title="Tier ladder — each segment is a Lit-enforced threshold">
      {tiers.map((t) => (
        <div
          key={t.index}
          className={`h-1.5 flex-1 rounded-full ${t.unlocked ? "bg-green-400/80" : "bg-red-500/40"}`}
        />
      ))}
    </div>
  );

  if (!encryptedPayloadUrl) {
    return (
      <div className="flex items-center justify-center h-32 text-white/20 text-xs font-mono">
        No content uploaded
      </div>
    );
  }

  if (state === "done" && decrypted) {
    const lockedTiers = tiers?.filter((t) => !t.unlocked).length ?? 0;
    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-mono text-green-400/60">
            {leakPct}% revealed · {formatBytes(revealedBytes)} / {formatBytes(totalBytes)}
            {isTiered && tiers && ` · ${tiers.length - lockedTiers}/${tiers.length} tiers`}
          </span>
          {revealedBytes < totalBytes && (
            <span className="text-xs text-white/30 font-mono">Buy Leak to unlock more →</span>
          )}
        </div>

        {tierBar}

        {/* Content */}
        {stripUrls ? (
          // image-strips: stack the unlocked crops top-to-bottom; locked
          // strips render as hatched placeholder rows
          <div className="rounded-xl overflow-hidden border border-white/8">
            {stripUrls.map((url, i) =>
              url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={url} alt={`Decrypted strip ${i + 1}`} className="w-full block" />
              ) : (
                <div
                  key={i}
                  className="w-full h-12 flex items-center justify-center text-[10px] font-mono text-red-400/40"
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, rgba(239,68,68,0.06), rgba(239,68,68,0.06) 4px, transparent 4px, transparent 12px)`,
                  }}
                >
                  🔒 tier {i + 1} locked — market hasn&apos;t unlocked this strip
                </div>
              ),
            )}
          </div>
        ) : textPreview !== null ? (
          <div className="relative">
            <pre className="p-4 rounded-xl bg-white/3 border border-white/8 text-white/70 text-xs font-mono leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap break-words">
              {textPreview || <span className="text-white/20">[no content revealed yet — buy Leak]</span>}
            </pre>
            {revealedBytes < totalBytes && (
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0c0c10] to-transparent rounded-b-xl pointer-events-none" />
            )}
          </div>
        ) : dataUrl ? (
          <div className="rounded-xl overflow-hidden border border-white/8">
            {kind === "image" && !imgBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dataUrl}
                alt="Decrypted content"
                className="w-full max-h-96 object-contain"
                onError={() => setImgBroken(true)}
              />
            ) : kind === "image" && imgBroken ? (
              <div className="p-4 text-white/40 text-xs font-mono space-y-2">
                <div>
                  {formatBytes(revealedBytes)} of {formatBytes(totalBytes)} decrypted — not enough of
                  the image is unlocked to render a preview yet.
                </div>
                <a href={dataUrl} download className="inline-block text-green-400 underline">
                  Download partial bytes
                </a>
              </div>
            ) : kind === "audio" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls src={dataUrl} className="w-full p-3" />
            ) : kind === "video" ? (
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

        {isTiered && (
          <p className="text-center text-[10px] text-white/20 font-mono">
            Tier thresholds enforced by Lit nodes against live pool reserves
          </p>
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
        {state === "decrypting" && "Asking Lit nodes which tiers the market unlocked…"}
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
        Requires LEAK · tier ladder enforced by Lit Protocol
      </p>
    </div>
  );
}
