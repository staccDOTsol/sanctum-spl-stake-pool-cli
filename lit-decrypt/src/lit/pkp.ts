/**
 * PKP (Programmable Key Pair) lifecycle helpers for Lit Protocol v8 Naga.
 *
 * PKPs are ERC-721 NFTs minted on the Lit Chronicle Yellowstone chain.
 * The private key is never reconstructed in a single location — it lives as
 * threshold MPC shares across Lit nodes.  A PKP's public key is used to
 * encrypt content; the Lit network collectively decrypts.
 */
import {
  LitNodeClientNodeJs,
} from "@lit-protocol/lit-node-client";
import { LIT_CHAINS } from "@lit-protocol/constants";

/** Minimal structure returned after minting a PKP. */
export interface MintedPKP {
  tokenId: string;
  publicKey: string;
  ethAddress: string;
}

/**
 * Mint a new PKP via the Lit contracts on Chronicle Yellowstone.
 *
 * Requires an Ethereum wallet with funds on Chronicle to pay gas.
 * The returned `tokenId` + `publicKey` should be persisted in the
 * EncryptedPayload metadata.
 *
 * NOTE: In production, use the `@lit-protocol/contracts-sdk` package for a
 *       type-safe wrapper around the PKP NFT contract.  The inline fetch
 *       below is a minimal stand-in for environments where that package is
 *       not available.
 */
export async function mintPKP(opts: {
  client: LitNodeClientNodeJs;
  /** Lit Chronicle Yellowstone RPC URL */
  chronicleRpcUrl?: string;
}): Promise<MintedPKP> {
  const chronicleUrl =
    opts.chronicleRpcUrl ?? "https://chain-rpc.litprotocol.com/http";

  // The PKP helper endpoint on the Lit relay server (free tier — no gas needed
  // for basic minting in testnet; for Naga mainnet, supply ETH on Chronicle).
  const relayUrl = "https://relay-server-staging.herokuapp.com/mint-next-and-add-auth-methods";

  const resp = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyType: 2,               // ECDSA secp256k1
      permittedAuthMethodTypes: [],
      permittedAuthMethodIds: [],
      permittedAuthMethodPubkeys: [],
      permittedAuthMethodScopes: [],
      addPkpEthAddressAsPermittedAddress: true,
      sendPkpToItself: true,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`PKP mint failed: ${resp.status} – ${txt}`);
  }

  const data = (await resp.json()) as {
    requestId: string;
    pkpTokenId?: string;
    pkpPublicKey?: string;
    pkpEthAddress?: string;
  };

  if (!data.pkpPublicKey) {
    throw new Error(`PKP mint response missing pkpPublicKey: ${JSON.stringify(data)}`);
  }

  return {
    tokenId: data.pkpTokenId ?? data.requestId,
    publicKey: data.pkpPublicKey,
    ethAddress: data.pkpEthAddress ?? "",
  };
}

/**
 * Fetch PKP info from the Lit relay for an already-minted tokenId.
 * Used to reconstruct PKP metadata from a persisted tokenId.
 */
export async function getPKPByTokenId(tokenId: string): Promise<MintedPKP> {
  const url = `https://relay-server-staging.herokuapp.com/get-pkp-eth-address?tokenId=${tokenId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch PKP: ${resp.status}`);
  const data = (await resp.json()) as {
    pkpPublicKey: string;
    pkpEthAddress: string;
  };
  return { tokenId, publicKey: data.pkpPublicKey, ethAddress: data.pkpEthAddress };
}
