/**
 * POST /api/lit/decrypt
 * Server-side Lit Protocol decryption. The browser signs the auth message
 * and sends the authSig here; the server calls the Lit nodes and returns
 * whatever the threshold ladder currently allows.
 *
 * Tiered (v2): body { payload: TieredPayload, authSig }
 *   Each chunk is attempted with its embedded conditions (tamper-proof —
 *   the condition hash is part of the ciphertext identity). Response:
 *   {
 *     version: 2, contentType,
 *     chunks: [{ index, unlocked }],
 *     unlockedBytes, totalBytes,
 *     data  — base64 of the CONTIGUOUS unlocked prefix (stops at the first
 *             locked chunk; that's the reveal frontier)
 *   }
 *
 * Legacy (v1): body { ciphertext, dataToEncryptHash, contentType?, authSig }
 *   Response: { data: base64 full plaintext, contentType }
 */
import { NextRequest, NextResponse } from "next/server";
import { makeLeakConditions, isTieredPayload, type TieredPayload } from "@/lib/litConditions";

export const runtime = "nodejs";
export const maxDuration = 120;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

async function getLitServer() {
  if (_client?.ready) return _client;
  const { LitNodeClient } = await import("@lit-protocol/lit-node-client");
  _client = new LitNodeClient({ litNetwork: "datil", debug: false });
  await _client.connect();
  return _client;
}

interface AuthSig { sig: string; derivedVia: string; signedMessage: string; address: string }

async function decryptTiered(payload: TieredPayload, authSig: AuthSig) {
  const client = await getLitServer();

  const results = await Promise.allSettled(
    payload.chunks.map((chunk) =>
      client.decrypt({
        solRpcConditions:  chunk.conditions,
        ciphertext:        chunk.ciphertext,
        dataToEncryptHash: chunk.dataToEncryptHash,
        authSig,
        chain: "solana",
      }),
    ),
  );

  const unlocked: (Uint8Array | null)[] = results.map((r) =>
    r.status === "fulfilled" ? (r.value.decryptedData as Uint8Array) : null,
  );

  // If even chunk 0 failed, surface why (most commonly: no LEAK)
  if (!unlocked[0]) {
    const first = results[0] as PromiseRejectedResult;
    const msg   = first.reason instanceof Error ? first.reason.message : "Access denied";
    const status = /access|condition|not authorized|unauthori[sz]ed/i.test(msg) ? 403 : 500;
    return NextResponse.json(
      { error: status === 403 ? "Access denied — you need LEAK tokens to decrypt" : msg },
      { status },
    );
  }

  // The reveal frontier: contiguous prefix up to the first locked chunk
  const prefixParts: Uint8Array[] = [];
  for (const part of unlocked) {
    if (!part) break;
    prefixParts.push(part);
  }
  const prefix = Buffer.concat(prefixParts.map((p) => Buffer.from(p)));

  return NextResponse.json({
    version:       2,
    contentType:   payload.contentType,
    totalBytes:    payload.totalBytes,
    unlockedBytes: prefix.length,
    chunks:        payload.chunks.map((c, i) => ({ index: c.index, unlocked: !!unlocked[i] })),
    data:          prefix.toString("base64"),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      payload?:           unknown;
      ciphertext?:        string;
      dataToEncryptHash?: string;
      contentType?:       string;
      authSig:            AuthSig;
    };

    if (!body.authSig) {
      return NextResponse.json({ error: "authSig required" }, { status: 400 });
    }

    // ── Tiered payload (v2) ──────────────────────────────────────────
    if (isTieredPayload(body.payload)) {
      return await decryptTiered(body.payload, body.authSig);
    }

    // ── Legacy single ciphertext (v1) ────────────────────────────────
    const { ciphertext, dataToEncryptHash, contentType, authSig } = body;
    if (!ciphertext || !dataToEncryptHash) {
      return NextResponse.json({ error: "payload (v2) or ciphertext+dataToEncryptHash (v1) required" }, { status: 400 });
    }

    const client = await getLitServer();
    const result = await client.decrypt({
      solRpcConditions:  makeLeakConditions(),
      ciphertext,
      dataToEncryptHash,
      authSig,
      chain: "solana",
    });

    const data = Buffer.from(result.decryptedData as Uint8Array).toString("base64");
    return NextResponse.json({ data, contentType: contentType ?? "application/octet-stream" });
  } catch (err: unknown) {
    console.error("[/api/lit/decrypt]", err);
    const msg = err instanceof Error ? err.message : "Decryption failed";
    const status = msg.toLowerCase().includes("access") || msg.toLowerCase().includes("condition") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
