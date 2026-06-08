# launch_hook — Token-2022 transfer-hook lamport round-trip

A transfer hook that, on every transfer of the hooked mint, skims excess lamports
from a System-owned vault PDA, wraps them to wSOL, round-trips wSOL→USDC→wSOL
through a **0%-fee Orca whirlpool you own**, and (separately) sweeps back home.

> **Status:** build target, NOT compiled/tested in this repo. Verify on **devnet**
> before mainnet. The Orca `swap_v2` CPI ordering + sqrt-price limits are the
> highest-risk parts — confirm against a live pool first.

## What's here
- `programs/launch_hook/src/lib.rs` — the on-chain program (Anchor).
- `client/` — TypeScript: create+seed the 0/0 wSOL/USDC pool, create the T2022
  mint+hook, write the `ExtraAccountMetaList`, fund the vault, trigger a transfer.
  *(FluxBeam `thook/USDC` + `thook/wSOL` pools are created in the FluxBeam app —
  there is no public pool-creation SDK; their app resolves hook accounts.)*

## Importing into Solana Playground (no laptop needed — works from a phone browser)
1. Open https://beta.solpg.io → **Create a new project → Anchor (Rust)**.
2. Replace `src/lib.rs` with this `programs/launch_hook/src/lib.rs`.
3. Open the `Cargo.toml` tab and set the dependencies to match
   `programs/launch_hook/Cargo.toml` (anchor 0.30.1 + the two SPL crates).
4. Top-right gear → **Endpoint → mainnet-beta** (or devnet first — recommended).
5. **Build** (this assigns the program ID and rewrites `declare_id!`).
6. Connect/seed the **Playground wallet** (it's yours; fund it), then **Deploy**.
7. Derive the vault: `findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)`
   → **fund that address** with the SOL you want to round-trip.
8. Run the client steps (Client tab) to create the pool, write the meta list,
   make the mint, and fire the transfer.

## Account / ordering notes
- The vault is **System-owned** (never `create_account` it) so lamports move via
  a signed `system_transfer`. It doubles as the swap `token_authority`.
- `ExtraAccountMetaList` order **must** match the indices in `lib.rs`
  (`I_VAULT=0 … I_SYS_PROG=15`).
- Tick arrays are fixed in the list; keep your seeded LP range narrow so the
  current price stays within `tick_array_0..2`, or swaps will fail.
- Setup order matters: **Orca pool + funded vault must exist before** you create
  FluxBeam pools — the FluxBeam seeding transfer is itself a hooked transfer.
