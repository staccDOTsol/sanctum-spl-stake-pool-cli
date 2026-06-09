/**
 * POST /api/lit/decrypt
 * Server-side Lit Protocol decryption. The browser signs the auth message
 * and sends the authSig here; the server calls the Lit nodes and returns
 * the decrypted bytes as base64. Never touches the browser Lit SDK.
 *
 * Body: { ciphertext, dataToEncryptHash, authSig }
 * Response: { data: string (base64), contentType: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { makeLeakConditions } from "@/lib/litConditions";

export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

async function getLitServer() {
  if (_client?.ready) return _client;
  const { LitNodeClient } = await import("@lit-protocol/lit-node-client");
  _client = new LitNodeClient({ litNetwork: "datil", debug: false });
  await _client.connect();
  return _client;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      ciphertext:        string;
      dataToEncryptHash: string;
      contentType?:      string;
      authSig:           { sig: string; derivedVia: string; signedMessage: string; address: string };
    };

    const { ciphertext, dataToEncryptHash, contentType, authSig } = body;
    if (!ciphertext || !dataToEncryptHash || !authSig) {
      return NextResponse.json({ error: "ciphertext, dataToEncryptHash, authSig required" }, { status: 400 });
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
    // Surface access-denied clearly so the client can show the right message
    const status = msg.toLowerCase().includes("access") || msg.toLowerCase().includes("condition") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
