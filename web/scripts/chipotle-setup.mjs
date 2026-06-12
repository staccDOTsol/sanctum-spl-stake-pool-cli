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
// BYTE-IDENTICAL to the runtime string: the capture starts immediately
// after the opening backtick (including the leading newline). Any
// difference changes the IPFS CID and the registered action won't match
// what the server executes.
const match = tsSource.match(/LADDER_ACTION_CODE = `([\s\S]*?)`;\s*$/);
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
  // Some endpoints legitimately return a bare JSON string on success
  // (e.g. /get_lit_action_ipfs_id returns the CID) — only HTTP status
  // distinguishes success from an ErrMessage.
  if (!res.ok) {
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
  console.log(`\n  *** SAVE THIS NOW ***\n  LIT_API_KEY=${apiKey}\n`);
  console.log(
    "  Wallet creation and action runs are PAID operations — fund this\n" +
    "  account first (min $5) at https://dashboard.chipotle.litprotocol.com\n" +
    "  using the API key above, then re-run:\n\n" +
    `    LIT_API_KEY=${apiKey} node scripts/chipotle-setup.mjs\n`,
  );
}

// Check balance before attempting paid operations
try {
  const bal = await api("/billing/balance", { method: "GET", key: apiKey });
  console.log(`• credit balance: ${JSON.stringify(bal)}`);
} catch { /* balance endpoint shape may vary; non-fatal */ }

async function paid(label, fn) {
  try {
    return await fn();
  } catch (e) {
    if (/HTTP 402/.test(String(e.message))) {
      console.error(
        `\n✗ ${label} returned 402 Payment Required — the account has no credits.\n` +
        "  Fund it (min $5) at https://dashboard.chipotle.litprotocol.com with\n" +
        `  the API key above, then re-run:\n\n    LIT_API_KEY=${apiKey} node scripts/chipotle-setup.mjs\n`,
      );
      process.exit(1);
    }
    throw e;
  }
}

// 2. PKP wallet — derives the content encryption keys.
//    Resume-safe: pass LIT_PKP_ID to reuse a wallet created on a prior run.
let pkpId = process.env.LIT_PKP_ID;
if (pkpId) {
  console.log(`• reusing PKP wallet from LIT_PKP_ID env: ${pkpId}`);
} else {
  const wallet = await paid("/create_wallet", () => api("/create_wallet", { method: "GET", key: apiKey }));
  pkpId = wallet.wallet_address;
  console.log(`✓ PKP wallet: ${pkpId}`);
}

// 3. Pin the ladder action: compute its IPFS CID, register it
const cid = await paid("/get_lit_action_ipfs_id", () => api("/get_lit_action_ipfs_id", { key: apiKey, body: ACTION_CODE }));
console.log(`✓ ladder action CID: ${cid}`);
await paid("/add_action", () => api("/add_action", {
  key: apiKey,
  body: { action_ipfs_cid: cid, name: "leak-ladder", description: "Threshold-ladder encrypt/decrypt for leak.markets" },
}));
console.log("✓ action registered");

// 4. Group binds the PKP to the action CID (structural access control).
//    Reuse an existing group when possible — usage keys are scoped to
//    specific group IDs, so adding the new action CID to an existing group
//    keeps already-minted runtime keys working without changes.
let groupId;
try {
  const groups = await api(`/list_groups?page_number=0&page_size=50`, { method: "GET", key: apiKey });
  if (Array.isArray(groups) && groups.length > 0) {
    groupId = Number(BigInt(groups[groups.length - 1].id));
    console.log(`• reusing existing group ${groupId}`);
  }
} catch { /* fall through to creating one */ }
if (!groupId) {
  const group = await paid("/add_group", () => api("/add_group", {
    key: apiKey,
    body: {
      group_name:           "leak-ladder-group",
      group_description:    "Only the ladder action may use the content PKP",
      pkp_ids_permitted:    [],
      cid_hashes_permitted: [],
    },
  }));
  console.log(`✓ group ${group.group_id}`);
  groupId = Number(group.group_id);
}
await paid("/add_action_to_group", () => api("/add_action_to_group", { key: apiKey, body: { group_id: groupId, action_ipfs_cid: cid } }));
await paid("/add_pkp_to_group",    () => api("/add_pkp_to_group",    { key: apiKey, body: { group_id: groupId, pkp_id: pkpId } }));
console.log("✓ action + PKP bound to group");

console.log(`
──────────────────────────────────────────────────────────
Set these in Vercel (Project → Settings → Environment Variables):

  LIT_API_KEY=${apiKey}
  LIT_PKP_ID=${pkpId}

Then ADD CREDITS (min $5) at https://dashboard.chipotle.litprotocol.com
— encrypt/decrypt executions consume credits.
──────────────────────────────────────────────────────────`);
