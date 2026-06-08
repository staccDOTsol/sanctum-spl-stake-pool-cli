# @leak-markets/protocol

**leak.markets** — Lit Protocol v8 (Naga Mainnet) + Meteora Dynamic Bonding Curve:
financially incentivised progressive content decryption.

## Architecture

```
Pool 1  Leak / rfstacc LST      base=Leak   quote=pSYRp…  binding=10 000 rfstacc
Pool 2  DontLeak / Leak         base=DontLeak  quote=Leak    supply=1 B tokens

r = Leak reserves / (Leak + DontLeak reserves)   ∈ [0, 1]
Released bytes = floor(r × totalBytes)            left-to-right prefix
```

The two pools are deployed on Meteora DBC.  The Pool 1 config is **platform-owned**
(leak.markets / rfstacc partners).  Each Pool 2 config is **user-owned** (the person
creating a new DontLeak instance is the Meteora partner).

## Deployment Flow

### 1 — Platform: create Pool 1 config (once)

```bash
# Generate and fund the platform keypair
lit-decrypt generate-platform-key --output platform-keypair.json
# → fund the printed pubkey with ≥ 0.05 SOL

# Deploy the shared Pool 1 DBC config (binding target = 10 000 rfstacc)
lit-decrypt create-leak-config \
  --keypair platform-keypair.json \
  --output leak-config.json
```

### 2 — User: deploy pools + mint tokens

```bash
# Deploys both pools; user is Pool 2 partner; DontLeak supply = 1 B
lit-decrypt create-pools \
  --leak-config <address from leak-config.json> \
  --keypair my-wallet.json \
  --output pool-deployment.json
```

### 3 — Encrypt a payload

```bash
lit-decrypt encrypt \
  --file secret-image.png \
  --pool-deployment pool-deployment.json \
  --output encrypted-payload.json
```

### 4 — Progressive decryption (permissionless)

```bash
lit-decrypt decrypt \
  --payload encrypted-payload.json \
  --eth-key 0x<your-ethereum-private-key>
# → writes decrypted-partial.png with floor(r × totalBytes) bytes
```

### 5 — Monitor ratio

```bash
lit-decrypt ratio --payload encrypted-payload.json --watch 10
# → polls every 10 s and prints live r
```

## Token Economics

| Token      | Pool | Role         | Supply    | Quote         |
|-----------|------|--------------|-----------|---------------|
| Leak       | 1    | Pro-decrypt  | 1 B       | rfstacc LST   |
| DontLeak   | 2    | Pro-secrecy  | 1 B       | Leak          |

- Buy Leak (Pool 1) → r rises → more bytes decrypted.
- Buy DontLeak (Pool 2) → r falls → fewer bytes visible.
- Arbitrageurs maintain accurate pricing across both pools.
- Pool 1 anti-snipe: starts at 99 % fee, decays to 1 % over ≈ 200 s.

## Lit Action

`src/lit/actions/progressive-decrypt.js` is the immutable TEE function.
Pin it to IPFS and pass the CID to `encrypt --lit-action-cid` for auditability.

## Install

```bash
cd lit-decrypt
npm install
npm run build
npm link   # or: npx tsx src/cli/index.ts <command>
```

Requires Node ≥ 18 and a funded Ethereum wallet on Lit Chronicle Yellowstone
for PKP minting.
