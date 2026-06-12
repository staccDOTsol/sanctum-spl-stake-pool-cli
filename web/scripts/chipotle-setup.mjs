/**
 * One-time Lit Chipotle (v3) provisioning for leak.markets.
 *
 * Creates an account, mints a PKP wallet, registers the immutable ladder
 * action, and binds them in a permission group. Prints the env vars to set
 * in Vercel. Funding: open the Dashboard (https://dashboard.chipotle.litprotocol.com)
 * with the printed API key and add credits (min $5) — action executions
 * consume credits.
 *
 * Usage: node scripts/chipotle-setup.mjs            (from web/)
 *        LIT_API_KEY=... node scripts/chipotle-setup.mjs   (reuse account)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LIT_API_BASE ?? "https://api.chipotle.litprotocol.com/core/v1";

// Extract the action source from the TS module without a build step.
const tsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "ladderAction.ts"), "utf8",
);
const match = tsSource.match(/LADDER_ACTION_CODE = `\n([\s\S]*?)`;\s*$/);
if (!match) throw new Error("could not extract LADDER_ACTION_CODE from lib/ladderAction.ts");
const ACTION_CODE = match[1];

async function api(path, { method = "POST", key, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-Api-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || typeof out === "string") {
    throw new Error(`${path} failed (HTTP ${res.status}): ${JSON.stringify(out)}`);
  }
  return out;
}

// 1. Account (reuse via LIT_API_KEY env if already provisioned)
let apiKey = process.env.LIT_API_KEY;
if (apiKey) {
  console.log("• reusing account from LIT_API_KEY env");
} else {
  const acct = await api("/new_account", {
    body: {
      account_name:        "leak.markets",
      account_description: "Tiered content decryption ladder (TEE-enforced)",
    },
  });
  apiKey = acct.api_key;
  console.log(`✓ account created — owner wallet ${acct.wallet_address}`);
}

// 2. PKP wallet — derives the content encryption keys
const wallet = await api("/create_wallet", { method: "GET", key: apiKey });
const pkpId  = wallet.wallet_address;
console.log(`✓ PKP wallet: ${pkpId}`);

// 3. Pin the ladder action: compute its IPFS CID, register it
const cid = await api("/get_lit_action_ipfs_id", { key: apiKey, body: ACTION_CODE });
console.log(`✓ ladder action CID: ${cid}`);
await api("/add_action", {
  key: apiKey,
  body: { action_ipfs_cid: cid, name: "leak-ladder", description: "Threshold-ladder encrypt/decrypt for leak.markets" },
});
console.log("✓ action registered");

// 4. Group binds the PKP to the action CID (structural access control)
const group = await api("/add_group", {
  key: apiKey,
  body: {
    group_name:           "leak-ladder-group",
    group_description:    "Only the ladder action may use the content PKP",
    pkp_ids_permitted:    [],
    cid_hashes_permitted: [],
  },
});
console.log(`✓ group ${group.group_id}`);
const groupId = Number(group.group_id);
await api("/add_action_to_group", { key: apiKey, body: { group_id: groupId, action_ipfs_cid: cid } });
await api("/add_pkp_to_group",    { key: apiKey, body: { group_id: groupId, pkp_id: pkpId } });
console.log("✓ action + PKP bound to group");

console.log(`
──────────────────────────────────────────────────────────
Set these in Vercel (Project → Settings → Environment Variables):

  LIT_API_KEY=${apiKey}
  LIT_PKP_ID=${pkpId}

Then ADD CREDITS (min $5) at https://dashboard.chipotle.litprotocol.com
— encrypt/decrypt executions consume credits.
──────────────────────────────────────────────────────────`);
