/**
 * Build Lit Protocol v8 session signatures using an Ethereum wallet.
 *
 * Session sigs are short-lived bearer tokens (EIP-4361 SIWE) that
 * authorise a client to interact with the Lit network on behalf of a PKP.
 * They are constructed via Viem's `createWalletClient` + `custom` transport
 * wrapping the private-key account — matching the v8 Viem-first SDK pattern.
 */
import { createWalletClient, custom, type WalletClient } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  LitAbility,
  LitActionResource,
  LitPKPResource,
  createSiweMessage,
  generateAuthSig,
} from "@lit-protocol/auth-helpers";
import type { LitNodeClientNodeJs } from "@lit-protocol/lit-node-client";
import type { AuthSig, SessionSigsMap } from "@lit-protocol/types";

/**
 * Build a Viem WalletClient from a hex private key.
 * The client signs SIWE messages to obtain session sigs.
 */
export function buildViemWalletClient(ethPrivateKeyHex: `0x${string}`): WalletClient {
  const account = privateKeyToAccount(ethPrivateKeyHex);
  return createWalletClient({
    account,
    chain: mainnet,
    transport: custom({
      request: async ({ method, params }) => {
        // minimal in-process provider: only eth_accounts + personal_sign needed
        if (method === "eth_accounts") return [account.address];
        if (method === "personal_sign") {
          const [message, _address] = params as [string, string];
          return account.signMessage({ message });
        }
        throw new Error(`Unsupported method: ${method}`);
      },
    }),
  });
}

/**
 * Derive session signatures authorising:
 *   - PKP signing  (LitPKPResource)
 *   - Lit Action execution (LitActionResource)
 *
 * Expiration defaults to 10 minutes from now.
 */
export async function getSessionSigs(opts: {
  client: LitNodeClientNodeJs;
  ethPrivateKeyHex: `0x${string}`;
  pkpPublicKey: string;
  /** Expiration ISO-8601 string (default: now + 10 min) */
  expiresAt?: string;
}): Promise<SessionSigsMap> {
  const { client, ethPrivateKeyHex, pkpPublicKey, expiresAt } = opts;

  const walletClient = buildViemWalletClient(ethPrivateKeyHex);
  const [address] = await walletClient.getAddresses();

  const expiration =
    expiresAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const sessionSigs = await client.getSessionSigs({
    chain: "ethereum",
    expiration,
    resourceAbilityRequests: [
      {
        resource: new LitPKPResource("*"),
        ability: LitAbility.PKPSigning,
      },
      {
        resource: new LitActionResource("*"),
        ability: LitAbility.LitActionExecution,
      },
    ],
    authNeededCallback: async ({ uri, expiration, resourceAbilityRequests }) => {
      const message = await createSiweMessage({
        uri: uri!,
        expiration: expiration!,
        resources: resourceAbilityRequests!,
        walletAddress: address,
        nonce: await client.getLatestBlockhash(),
        litNodeClient: client,
      });

      const authSig: AuthSig = await generateAuthSig({
        signer: {
          signMessage: async ({ message: msg }: { message: string }) =>
            walletClient.signMessage({ message: msg, account: walletClient.account! }),
          getAddress: async () => address,
        },
        toSign: message,
      });

      return authSig;
    },
  });

  return sessionSigs;
}
