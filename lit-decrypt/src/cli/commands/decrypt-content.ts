/**
 * `decrypt`
 *
 * Permissionlessly triggers a progressive decryption call against Lit Naga.
 *
 * The Lit Action (running in TEE) fetches live Meteora DBC reserve data from
 * Solana, computes the ratio r, decrypts the full payload, and returns only
 * the first floor(r × totalBytes) bytes.
 *
 * The partial bytes are written to disk.  For PNG/JPEG, any standard image
 * decoder will render the partial content.  For text, the output is the first
 * N bytes of the plaintext.
 */
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLitClient, disconnectLitClient } from "../../lit/client.js";
import { getSessionSigs } from "../../lit/session.js";
import { progressiveDecrypt } from "../../lit/decrypt.js";
import type { EncryptedPayload } from "../../types.js";

export function registerDecryptCommand(program: Command): void {
  program
    .command("decrypt")
    .description(
      "Trigger progressive decryption via Lit Naga TEE. " +
      "Returns the byte prefix determined by live pool reserves."
    )
    .requiredOption(
      "--payload <path>",
      "Path to encrypted-payload.json (from encrypt command)"
    )
    .requiredOption(
      "--eth-key <hex>",
      "Ethereum private key (0x…) for Lit session signature"
    )
    .option(
      "--output <path>",
      "Output path for decrypted prefix bytes (extension auto-set from content type)"
    )
    .option(
      "--expiry-minutes <n>",
      "Session signature validity in minutes",
      "10"
    )
    .action(async (opts: {
      payload: string;
      ethKey: string;
      output?: string;
      expiryMinutes: string;
    }) => {
      const client = await getLitClient();

      try {
        const payloadRaw = await readFile(path.resolve(opts.payload), "utf8");
        const payload: EncryptedPayload = JSON.parse(payloadRaw);

        const ethKey = opts.ethKey.startsWith("0x")
          ? (opts.ethKey as `0x${string}`)
          : (`0x${opts.ethKey}` as `0x${string}`);

        const expiresAt = new Date(
          Date.now() + parseInt(opts.expiryMinutes) * 60 * 1000
        ).toISOString();

        console.log("Generating Lit session signatures...");
        const sessionSigs = await getSessionSigs({
          client,
          ethPrivateKeyHex: ethKey,
          pkpPublicKey: payload.pkpPublicKey,
          expiresAt,
        });

        console.log("Calling Lit Action (progressive-decrypt) in TEE...");
        const result = await progressiveDecrypt({ client, sessionSigs, payload });

        const { partialBytes, snapshot } = result;
        console.log(`\nDecryption result:`);
        console.log(`  Leak reserves     : ${snapshot.leakReserve.toString()}`);
        console.log(`  DontLeak reserves : ${snapshot.dontLeakReserve.toString()}`);
        console.log(`  Ratio r           : ${(snapshot.r * 100).toFixed(2)} %`);
        console.log(`  Bytes released    : ${partialBytes.length} / ${payload.totalBytes}`);

        // Determine output path
        const extMap: Record<string, string> = { png: "png", jpeg: "jpg", text: "txt" };
        const ext = extMap[payload.contentType] ?? "bin";
        const outPath = opts.output
          ? path.resolve(opts.output)
          : path.resolve(`decrypted-partial.${ext}`);

        await writeFile(outPath, Buffer.from(partialBytes));
        console.log(`  Saved to          : ${outPath}`);

        if (snapshot.r >= 1) {
          console.log("\n✓ Full payload decrypted (r = 100 %).");
        } else if (snapshot.r === 0) {
          console.log(
            "\n⚠  r = 0 — no bytes released. Buy Leak tokens to increase the ratio."
          );
        }
      } finally {
        await disconnectLitClient();
      }
    });
}
