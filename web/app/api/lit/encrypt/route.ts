/**
 * POST /api/lit/encrypt
 * Server-side Lit Protocol encryption. Receives a file, encrypts with the
 * LEAK token access condition, returns the ciphertext JSON. Never touches
 * the browser Lit SDK (which fails on iOS Safari).
 *
 * Body: multipart/form-data with field "file"
 */
import { NextRequest, NextResponse } from "next/server";

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

function makeLeakConditions() {
  return [
    {
      conditionType: "solRpc" as const,
      method:        "getTokenAccountsByOwner",
      params: [
        ":userAddress",
        JSON.stringify({ mint: "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS" }),
        JSON.stringify({ encoding: "jsonParsed" }),
      ],
      pdaInterface: { offset: 0, fields: {} as Record<string, unknown> },
      pdaKey:  "",
      chain:   "solana" as const,
      returnValueTest: {
        key:        "$.value[0].account.data.parsed.info.tokenAmount.uiAmount",
        comparator: ">" as const,
        value:      "0",
      },
    },
  ];
}

export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData();
    const file        = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

    const rawBytes    = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const client = await getLitServer();
    const { ciphertext, dataToEncryptHash } = await client.encrypt({
      solRpcConditions: makeLeakConditions(),
      dataToEncrypt:    rawBytes,
    });

    return NextResponse.json({ ciphertext, dataToEncryptHash, contentType, filename: file.name });
  } catch (err: unknown) {
    console.error("[/api/lit/encrypt]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Encryption failed" },
      { status: 500 },
    );
  }
}
