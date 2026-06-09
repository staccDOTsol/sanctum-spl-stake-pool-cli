# SWITCHEROO — Launch Announcement

Longform single-tweet (X Premium+) copy. Post as one tweet; line breaks intentional.

---

introducing THE SWITCHEROO ⇄

the first provably-fair token gacha on Solana. no house. no edge. no cap (literally, the cap is 10,000×).

here's the whole mechanic:

🎰 delegate a bag into the pool — one signature sweeps every token under your threshold ("one-swoop approval")
🎲 pay a 0.003 ◎ roll fee
⇄ the matchmaker swaps your tokens with a random stranger's. all of them. theirs are yours now. yours are theirs.

you might pull 0.86×. you might pull 10,000×. somebody's $8 of HARRYBOLZ is about to become somebody else's $6,800 of FARTCOIN, and the chain will remember forever.

"random" how? provably:

→ your roll locks a request slot S
→ entropy = Solana's slot hash at S+1 — unknowable at request time, immutable after ~400ms
→ counterparty = sha256(slot_hash ‖ your_pubkey) mod pool_size
→ every roll ships a receipt: slot, hash, index. re-derive it yourself. we can't cherry-pick, we can't reroll, we can't see the future.

rarity is just math wearing a costume:
3★ COMMON — a lateral move
4★ RARE — up only. slightly
5★ EPIC — now we're cooking
SSR LEGENDARY — generationally unserious
UR SWITCHEROO — the pool went home broke

full pity system. soft pity ramps at 74, hard pity at 90 — after 90 rolls of pain the matchmaker is contractually incapable of matching you down. 10-pulls guaranteed 4★+.

and the part nobody else does: NO HOUSE EDGE.

the only thing we keep is ~0.00408 ◎ of account rent per swap. 40% of every roll fee pays FORWARD to earlier rollers — exponentially weighted, roller #1 earns ~2× roller #2, forever. every roll also mints $EARLY. play early, get paid by everyone who comes after you. the casino is the community and the community is the casino.

same-tier matching only (blue-chip ↔ blue-chip, launch ↔ launch) — you can't farm the pool with dust.

100% custodial. the matchmaker holds delegate + close authority on every swept ATA. that's the whole trick. that's the bit. everything else is zero-sum degeneracy with a receipt.

tired of gambling? stacsol.app · degensol.app

wish responsibly ⇄
