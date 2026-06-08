/**
 * `encrypt`
 *
 * Encrypts a PNG, JPEG, or flat-text file with Lit Protocol v8 (Naga mainnet).
 *
 * Steps:
 *   1. Mint a new PKP (requires ETH on Chronicle Yellowstone for gas).
 *   2. Encrypt the raw byte payload with the PKP's eth-address as ACC.
 *   3. Write EncryptedPayload metadata JSON to disk.
 *
 * The resulting JSON contains everything needed to call `decrypt` later.
 */
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getLitClient, disconnectLitClient } from "../../lit/client.js";
import { mintPKP } from "../../lit/pkp.js";
import { encryptPayload, readFileAsBytes } from "../../lit/encrypt.js";
import type { PoolConfig } from "../../types.js";

export function registerEncryptCommand(program: Command): void {
  program
    .command("encrypt")
    .description("Encrypt a PNG/JPEG/text payload with Lit v8. Outputs metadata JSON.")
    .requiredOption("--file <path>", "Path to the file to encrypt")
    .requiredOption("--pool-deployment <path>", "Path to pool-deployment.json (from create-pools)")
    .option("--output <path>", "Output path for encrypted payload JSON", "./encrypted-payload.json")
    .option(
      "--lit-action-cid <cid>",
      "IPFS CID of the pinned progressive-decrypt Lit Action (optional, for auditability)"
    )
    .action(async (opts: {
      file: string;
      poolDeployment: string;
      output: string;
      litActionCid?: string;
    }) => {
      const client = await getLitClient();

      try {
        // Load pool deployment metadata
        const { readFile } = await import("node:fs/promises");
        const deploymentRaw = JSON.parse(
          await readFile(path.resolve(opts.poolDeployment), "utf8")
        );
        const poolConfig: PoolConfig = {
          leakPoolAddress: deploymentRaw.leakPoolAddress,
          dontLeakPoolAddress: deploymentRaw.dontLeakPoolAddress,
          leakMint: deploymentRaw.leakMint,
          dontLeakMint: deploymentRaw.dontLeakMint,
          poolConfigAddress: deploymentRaw.pool1ConfigAddress,
        };

        // Read plaintext bytes
        const { bytes, contentType } = await readFileAsBytes(path.resolve(opts.file));
        console.log(`File: ${opts.file} (${bytes.length} bytes, type=${contentType})`);

        // Mint PKP
        console.log("Minting PKP on Lit Chronicle Yellowstone...");
        const pkp = await mintPKP({ client });
        console.log(`PKP public key : ${pkp.publicKey}`);
        console.log(`PKP token ID   : ${pkp.tokenId}`);
        console.log(`PKP eth address: ${pkp.ethAddress}`);

        // Encrypt
        console.log("Encrypting payload on Lit Naga mainnet...");
        const encrypted = await encryptPayload({
          client,
          plaintext: bytes,
          contentType,
          pkp,
          poolConfig,
          litActionIpfsCid: opts.litActionCid,
        });

        await writeFile(
          path.resolve(opts.output),
          JSON.stringify(encrypted, null, 2),
          "utf8"
        );

        console.log("\nEncryption complete!");
        console.log(`  Payload size    : ${bytes.length} bytes`);
        console.log(`  Content type    : ${contentType}`);
        console.log(`  Ciphertext len  : ${encrypted.ciphertext.length} chars`);
        console.log(`  Metadata saved  : ${opts.output}`);
      } finally {
        await disconnectLitClient();
      }
    });
}
