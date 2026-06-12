/**
 * POST /api/register
 * Register a new content entry after successful pool deployment.
 */
import { NextRequest, NextResponse } from "next/server";
import { registerContent } from "@/lib/registry";
import type { ContentEntry } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const entry: ContentEntry = {
      id:                  `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title:               body.title ?? "Untitled",
      description:         body.description ?? "",
      contentType:         body.contentType ?? "text",
      leakPoolAddress:     body.leakPoolAddress,
      dontLeakPoolAddress: body.dontLeakPoolAddress,
      leakMint:            body.leakMint,
      dontLeakMint:        body.dontLeakMint,
      totalBytes:          body.totalBytes ?? 0,
      createdAt:           Date.now(),
      creator:             body.creator,
      encryptedPayloadUrl: body.encryptedPayloadUrl,
      metadataUrl:         body.metadataUrl,
      poolType:            body.poolType ?? "stable",
      quoteMint:           body.quoteMint,
      isBounty:            !!body.isBounty,
      bountyPubkey:        body.bountyPubkey,
    };

    if (!entry.dontLeakPoolAddress) {
      return NextResponse.json({ error: "dontLeakPoolAddress is required" }, { status: 400 });
    }

    await registerContent(entry);
    return NextResponse.json({ id: entry.id });
  } catch (err: unknown) {
    console.error("[/api/register]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
