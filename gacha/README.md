# THE SWITCHEROO — provably-fair token gacha

Delegate a token into the pool, pay a SOL roll fee, and the matchmaker swaps
your tokens with a random pool member's — 0.86× to 10,000×, selected by
Solana slot-hash randomness. No house edge: the matchmaker keeps only the
~0.00408 ◎ of ATA rent per swap, and 40% of every roll fee is paid forward
to earlier rollers (exponentially weighted by join order).

## Pieces

- `app/` — the offchain matchmaker crank + CLI (`matchmaker`, `delegate`,
  `revoke`, `roll`, `pool`, `points`, `leaderboard`).
- `../web/app/gacha` — the anime-gacha web experience (banner, wish
  animation, rarity reveals, 10-pulls, pity, collection log, provably-fair
  receipts). Runs in sim mode standalone; overlays live crank data when
  `MATCHMAKER_URL` is set for the web app.
- `ANNOUNCEMENT.md` — launch tweet copy.

## Matchmaker HTTP endpoints

The health server (`PORT`, default 3000) serves JSON with CORS enabled:

| Endpoint | Returns |
| --- | --- |
| `/health` | liveness |
| `/stats` | pool size, total swaps/rolls/rollers, roll fee, pity config |
| `/swaps?limit=N` | recent swaps with the full provably-fair receipt trail (request slot, entropy slot, slot hash, derived index, pool size, multiplier, rarity) |
| `/swaps/:pubkey` | swaps involving a pubkey |
| `/pity/:pubkey` | pity counter + whether the up-only guarantee is armed |
| `/points/:pubkey` | dividend points and SOL earnings |
| `/leaderboard` | all rollers by join order |

## Gacha mechanics implemented by the crank

- **Multi-roll (10-pull):** one payment of N× the roll fee buys N swaps
  (capped at `MAX_ROLLS_PER_PAYMENT`, default 10). Each pull gets fresh
  slot-hash entropy.
- **Pity:** after `GACHA_PITY_HARD` (default 90) consecutive losing rolls,
  the candidate set is restricted to counterparties worth at least your bag —
  a guaranteed up-only roll. Selection within the restricted set is still
  slot-hash random, and the filter rule is deterministic and auditable from
  the receipt (`pityTriggered`).
- **Rarity bands** (from the swap multiplier): common < 1.5×, rare < 5×,
  epic < 50×, legendary < 800×, jackpot ≥ 800×.
- **Tier matching:** swaps only happen within the same token tier
  (blue-chip / launch / unknown) so the pool can't be farmed with dust.

## Verifying a roll

Every swap record carries `requestSlot`, `entropySlot` (= request + 1),
`slotHash`, `randomIndex`, and `poolSize`. Re-derive:

```
index = u64_le(sha256(slot_hash || requester_pubkey)[0..8]) % pool_size
```

The slot hash at `entropySlot` is unknowable at request time and immutable
~400ms later, so the matchmaker cannot predict or cherry-pick counterparties.
