/**
 * GET /api/registry/sync
 *
 * Scans the Meteora DBC program for all pools under the leak.markets
 * shared configs, rebuilds ContentEntry records from Token-2022 mint
 * metadata, and writes the result to Vercel Blob (registry/index.json).
 *
 * Requires env vars:
 *   STABLE_POOL_CONFIG   — shared config address for stable (LEAK quote) pools
 *   MEME_POOL_CONFIG     — shared config address for meme pools
 *   QUOTA_POOL_CONFIG    — shared config address for quotiest-quote pools
 *
 * VirtualPool account layout (Anchor, Borsh):
 *   offset   0 :  8 bytes  — discriminator
 *   offset   8 :  64 bytes — volatilityTracker
 *   offset  72 :  32 bytes — config  ← memcmp filter here
 *   offset 104 :  32 bytes — creator
 *   offset 136 :  32 bytes — baseMint ← DontLeak / content mint
 */
import { NextResponse }      from "next/server";
import { Connection, PublicKey, GetProgramAccountsFilter } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getTokenMetadata }         from "@solana/spl-token";
import { replaceRegistry }   from "../../../../lib/registry";
import type { ContentEntry, PoolType } from "../../../../lib/types";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";

const RPC = process.env.SOLANA_RPC_URL
  ?? "https://mainnet.helius-rpc.com/?api-key=d1c96b01-1c06-4d46-9b69-57e7260fb9d8";

const DBC_PROGRAM = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const CONFIG_OFFSET  = 72;
const BASE_MINT_OFFSET = 136;

async function poolsForConfig(
  conn: Connection,
  configAddress: string,
): Promise<PublicKey[]> {
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: CONFIG_OFFSET, bytes: configAddress } },
  ];
  const accounts = await conn.getProgramAccounts(DBC_PROGRAM, {
    filters,
    dataSlice: { offset: BASE_MINT_OFFSET, length: 32 },
  });
  return accounts.map(a => new PublicKey(a.account.data));
}

async function entryFromMint(
  conn: Connection,
  baseMint: PublicKey,
  poolType: PoolType,
): Promise<ContentEntry | null> {
  try {
    const meta = await getTokenMetadata(conn, baseMint, "confirmed", TOKEN_2022_PROGRAM_ID);
    if (!meta?.uri) return null;

    const res = await fetch(meta.uri, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();

    // Pull structured data out of attributes array
    const attr = (key: string) =>
      json.attributes?.find((a: { trait_type: string; value: unknown }) => a.trait_type === key)?.value;

    const protocol = attr("Protocol");
    if (protocol !== "leak.markets") return null;

    const dontLeakPool = attr("DontLeakPool") as string | undefined;
    const leakPool     = attr("LeakPool")     as string | undefined;
    const leakMint     = attr("LeakMint")     as string | undefined;
    const quoteMint    = attr("QuoteMint")    as string | undefined;
    const contentUrl   = attr("EncryptedContentUrl") as string | undefined;
    const totalBytes   = Number(attr("TotalBytes") ?? 0);
    const contentType  = (attr("ContentType") ?? "text") as ContentEntry["contentType"];
    const creator      = attr("Creator") as string | undefined;
    const pt           = (attr("PoolType") ?? poolType) as PoolType;

    if (!dontLeakPool) return null;

    return {
      id:                  baseMint.toBase58(),
      title:               String(json.name ?? "").replace(/^DontLeak:\s*/, ""),
      description:         String(json.description ?? ""),
      contentType,
      leakPoolAddress:     leakPool     ?? "",
      dontLeakPoolAddress: dontLeakPool,
      leakMint:            leakMint     ?? "",
      dontLeakMint:        baseMint.toBase58(),
      totalBytes,
      encryptedPayloadUrl: contentUrl,
      metadataUrl:         meta.uri,
      createdAt:           Date.now(),
      creator,
      poolType:            pt,
      quoteMint,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const conn = new Connection(RPC, "confirmed");

  const configs: { address: string; poolType: PoolType }[] = (
    [
      { address: process.env.STABLE_POOL_CONFIG ?? "", poolType: "stable" as PoolType },
      { address: process.env.MEME_POOL_CONFIG   ?? "", poolType: "meme"   as PoolType },
    ] as { address: string; poolType: PoolType }[]
  ).filter(c => c.address.length > 0);

  if (configs.length === 0) {
    return NextResponse.json({ error: "No config addresses configured" }, { status: 503 });
  }

  const entries: ContentEntry[] = [];

  for (const { address, poolType } of configs) {
    let mints: PublicKey[];
    try {
      mints = await poolsForConfig(conn, address);
    } catch (e) {
      console.error(`getProgramAccounts failed for config ${address}:`, e);
      continue;
    }

    const resolved = await Promise.all(
      mints.map(mint => entryFromMint(conn, mint, poolType))
    );
    entries.push(...resolved.filter((e): e is ContentEntry => e !== null));
  }

  await replaceRegistry(entries);

  return NextResponse.json({ synced: entries.length, entries });
}
