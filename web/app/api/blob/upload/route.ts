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
export const maxDuration = 60;

// Raise Next.js body size limit to 50 MB for this route
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

const ALLOWED_TYPES = new Set(["token-image", "token-metadata", "payload-metadata", "content"]);

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

  // Prefix by type so blobs are browsable in the Vercel dashboard
  const blobPath = `${type}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const blob = await put(blobPath, file.stream(), {
    access: "public",
    contentType: file.type || "application/octet-stream",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return NextResponse.json({ url: blob.url, pathname: blob.pathname });
}
