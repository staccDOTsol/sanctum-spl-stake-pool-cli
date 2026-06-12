/* End-to-end smoke test of the server-side Lit flow against datil.
 * 1. encrypt bytes with the LEAK condition (same code path as /api/lit/encrypt)
 * 2. decrypt with a correctly-formed hex authSig from a wallet with NO LEAK
 *    -> expect NodeAccessControlConditionsReturnedNotAuthorized (access denied)
 * 3. decrypt with the OLD base64 sig format
 *    -> expect a signature/validation error (different failure)
 */
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";

const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";

function makeLeakConditions() {
  return [
    {
      conditionType: "solRpc",
      method: "getTokenAccountsByOwner",
      params: [
        ":userAddress",
        JSON.stringify({ mint: LEAK_MINT }),
        JSON.stringify({ encoding: "jsonParsed" }),
      ],
      pdaParams: [],
      pdaInterface: { offset: 0, fields: {} },
      pdaKey: "",
      chain: "solana",
      returnValueTest: {
        key: `$[?(@.account.data.parsed.info.mint == '${LEAK_MINT}')].account.data.parsed.info.tokenAmount.amount`,
        comparator: ">",
        value: "0",
      },
    },
  ];
}

const kp = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(new URL("../../platform-keypair.json", import.meta.url), "utf8")))
);
const pubkey = kp.publicKey.toBase58();
console.log("wallet:", pubkey, "(holds no LEAK — expect access denied)");

const client = new LitNodeClient({ litNetwork: "datil", debug: false });
await client.connect();
console.log("✓ connected to datil, ready =", client.ready);

const plaintext = new TextEncoder().encode("leak.markets smoke test " + Date.now());
const { ciphertext, dataToEncryptHash } = await client.encrypt({
  solRpcConditions: makeLeakConditions(),
  dataToEncrypt: plaintext,
});
console.log("✓ encrypted, hash =", dataToEncryptHash.slice(0, 16) + "…");

const message = `I am creating an account to use Lit Protocol at ${new Date().toISOString()}`;
const msgBytes = new TextEncoder().encode(message);
const sig = nacl.sign.detached(msgBytes, kp.secretKey);

async function tryDecrypt(label, sigStr) {
  const authSig = {
    sig: sigStr,
    derivedVia: "solana.signMessage",
    signedMessage: message,
    address: pubkey,
  };
  try {
    const res = await client.decrypt({
      solRpcConditions: makeLeakConditions(),
      ciphertext,
      dataToEncryptHash,
      authSig,
      chain: "solana",
    });
    console.log(`[${label}] UNEXPECTED SUCCESS:`, new TextDecoder().decode(res.decryptedData));
  } catch (e) {
    console.log(`[${label}] error name: ${e?.name ?? "?"}`);
    console.log(`[${label}] message: ${String(e?.message).slice(0, 400)}`);
  }
}

await tryDecrypt("hex sig (fixed)", Buffer.from(sig).toString("hex"));
await tryDecrypt("base64 sig (old bug)", Buffer.from(sig).toString("base64"));
process.exit(0);

/* ---- Tiered ladder smoke (v2): encrypt one chunk behind vault thresholds
 * chosen to PASS right now, so only the holds-LEAK clause gates it. ---- */
const vaultCond = (addr, comparator, value) => ({
  conditionType: "solRpc", method: "getTokenAccountBalance", params: [addr],
  pdaParams: [], pdaInterface: { offset: 0, fields: {} }, pdaKey: "", chain: "solana",
  returnValueTest: { key: "$.amount", comparator, value },
});
const L1_VAULT = "CFNWyztk8gCpjdX5DNiw2opwMNq7wMcHAbyiG3283ywg"; // ze1Hvk quote vault
const tierSet = [
  makeLeakConditions()[0],
  { operator: "and" },
  vaultCond(L1_VAULT, ">=", "1"),                       // passes while vault > 0
  { operator: "and" },
  vaultCond(L1_VAULT, "<", "999999999999999999"),       // effectively no ceiling
];
const tierEnc = await client.encrypt({ solRpcConditions: tierSet, dataToEncrypt: plaintext });
console.log("✓ tier chunk encrypted, hash =", tierEnc.dataToEncryptHash.slice(0, 16) + "…");
try {
  const res = await client.decrypt({
    solRpcConditions: tierSet, ciphertext: tierEnc.ciphertext,
    dataToEncryptHash: tierEnc.dataToEncryptHash,
    authSig: { sig: Buffer.from(sig).toString("hex"), derivedVia: "solana.signMessage", signedMessage: message, address: pubkey },
    chain: "solana",
  });
  console.log("[tier] decrypted:", new TextDecoder().decode(res.decryptedData));
} catch (e) {
  console.log("[tier] error (expect access-denied w/o LEAK):", String(e?.message).slice(0, 200));
}
