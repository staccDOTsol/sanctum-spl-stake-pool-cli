/**
 * POST /api/blob/token-metadata
 *
 * Convenience endpoint: builds and uploads Metaplex-compatible JSON metadata
 * for the Leak or DontLeak token, then returns the metadata URL.
 *
 * Body JSON:
 *   name        – "Leak" | "DontLeak"
 *   symbol      – "LEAK" | "DLEAK"
 *   description – string
 *   imageUrl    – URL of the already-uploaded token logo
 *   mintAddress – Solana mint pubkey (string)
 *   attributes  – optional extra attributes
 */
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface MetaplexAttribute {
  trait_type: string;
  value: string | number;
}

interface MetadataBody {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  mintAddress: string;
  attributes?: MetaplexAttribute[];
}

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured" }, { status: 503 });
  }

  const body: MetadataBody = await req.json();
  const { name, symbol, description, imageUrl, mintAddress, attributes = [] } = body;

  if (!name || !symbol || !imageUrl || !mintAddress) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const metadata = {
    name,
    symbol,
    description,
    image: imageUrl,
    external_url: "https://leak.markets",
    attributes: [
      { trait_type: "Protocol", value: "leak.markets" },
      { trait_type: "Network",  value: "Solana" },
      { trait_type: "Standard", value: "Token-2022" },
      ...attributes,
    ],
    properties: {
      category: "fungible",
      files: [{ uri: imageUrl, type: "image/png" }],
    },
  };

  const json = JSON.stringify(metadata, null, 2);
  const blobPath = `token-metadata/${mintAddress}-${symbol.toLowerCase()}.json`;

  const blob = await put(blobPath, json, {
    access: "public",
    contentType: "application/json",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return NextResponse.json({ url: blob.url, metadata });
}
