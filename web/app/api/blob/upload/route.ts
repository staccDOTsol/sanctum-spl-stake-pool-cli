/**
 * POST /api/blob/upload
 *
 * Uploads a file to Vercel Blob and returns the public URL.
 * Used to store:
 *   - Leak token logo (PNG/SVG)
 *   - DontLeak token logo (PNG/SVG)
 *   - Token metadata JSON (Metaplex standard)
 *   - Encrypted payload metadata JSON
 *
 * Body: multipart/form-data with fields:
 *   file      – the file to upload
 *   filename  – desired filename (e.g. "leak-metadata.json")
 *   type      – "token-image" | "token-metadata" | "payload-metadata"
 *
 * Requires BLOB_READ_WRITE_TOKEN env var (set in Vercel project settings).
 */
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["token-image", "token-metadata", "payload-metadata"]);

const MAX_SIZE_BYTES: Record<string, number> = {
  "token-image":    512_000,    // 500 KB
  "token-metadata": 64_000,     // 64 KB
  "payload-metadata": 256_000,  // 256 KB
};

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured" },
      { status: 503 }
    );
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const filename = (form.get("filename") as string | null) ?? "upload";
  const type = (form.get("type") as string | null) ?? "payload-metadata";

  if (!file) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
  }

  const maxSize = MAX_SIZE_BYTES[type];
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes (max ${maxSize})` },
      { status: 413 }
    );
  }

  // Prefix by type so blobs are browsable in the Vercel dashboard
  const blobPath = `${type}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const blob = await put(blobPath, file.stream(), {
    access: "public",
    contentType: file.type || "application/octet-stream",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return NextResponse.json({ url: blob.url, pathname: blob.pathname });
}
