import { PublicKey } from "@solana/web3.js";

export interface DelegateEntry {
  owner: PublicKey;
  ata: PublicKey;
  mint: PublicKey;
  registeredAmount: bigint;
  registeredAt: number;
  isActive: boolean;
  pda: PublicKey;
}

export interface RollRequest {
  requester: PublicKey;
  requesterAta: PublicKey;
  requestSlot: bigint;
  rollFeeLamports: bigint;
}

export interface SwapResult {
  signature: string;
  requester: PublicKey;
  counterparty: PublicKey;
  requesterMint: PublicKey;
  counterpartyMint: PublicKey;
  requesterAmount: bigint;
  counterpartyAmount: bigint;
  requesterUsd: number;
  counterpartyUsd: number;
  entropySlot: bigint;
  randomIndex: bigint;
  poolSizeAtRoll: bigint;
}

export interface TokenPrice {
  mint: string;
  usdPrice: number;
  /** Amount of token per USD */
  usdPerToken: number;
}
