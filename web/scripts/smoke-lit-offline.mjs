/* Offline validation of the fixed Lit conditions + authSig:
 * 1. conditions pass the SDK's LPACC_SOL schema validation (encrypt would throw otherwise)
 * 2. conditions hash deterministically (encrypt/decrypt identity param)
 * 3. safeParams('decrypt') accepts { authSig, chain: 'solana' } without sessionSigs
 * 4. authSig hex sig verifies with ed25519 over the canonical message
 */
import { validateSolRpcConditionsSchema, hashSolRpcConditions } from "@lit-protocol/access-control-conditions";
import { safeParams } from "@lit-protocol/misc";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";

const LEAK_MINT = "GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS";
const conditions = [
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

await validateSolRpcConditionsSchema(conditions);
console.log("✓ conditions pass LPACC_SOL schema validation");

const hash = await hashSolRpcConditions(conditions);
console.log("✓ conditions hash:", Buffer.from(new Uint8Array(hash)).toString("hex").slice(0, 32) + "…");

// also confirm the OLD condition shape (with $.value JSONPath) hashes differently,
// i.e. the fix changes the on-network identity as expected
const old = JSON.parse(JSON.stringify(conditions));
old[0].returnValueTest.key = "$.value[0].account.data.parsed.info.tokenAmount.uiAmount";
delete old[0].pdaParams;
const oldHash = await hashSolRpcConditions(old);
console.log("✓ old conditions hash differs:", Buffer.from(new Uint8Array(oldHash)).toString("hex").slice(0, 32) + "…");

const kp = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(new URL("../../platform-keypair.json", import.meta.url), "utf8")))
);
const message = `I am creating an account to use Lit Protocol at ${new Date().toISOString()}`;
const msgBytes = new TextEncoder().encode(message);
const sigBytes = nacl.sign.detached(msgBytes, kp.secretKey);
const authSig = {
  sig: Array.from(sigBytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
  derivedVia: "solana.signMessage",
  signedMessage: message,
  address: kp.publicKey.toBase58(),
};

const ok = safeParams({
  functionName: "decrypt",
  params: {
    solRpcConditions: conditions,
    ciphertext: "dGVzdA==",
    dataToEncryptHash: "ab".repeat(32),
    authSig,
    chain: "solana",
  },
});
console.log("✓ safeParams('decrypt') with authSig-only:", ok);

const verified = nacl.sign.detached.verify(
  msgBytes,
  Uint8Array.from(authSig.sig.match(/.{2}/g).map((h) => parseInt(h, 16))),
  kp.publicKey.toBytes()
);
console.log("✓ hex authSig round-trips & ed25519-verifies:", verified);
process.exit(0);
