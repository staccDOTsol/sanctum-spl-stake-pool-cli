/**
 * The leak.markets "ladder" Lit Action — immutable JS executed inside the
 * Chipotle TEE. This is the ONLY code path that can derive the content key
 * (PKP-scoped), so the threshold gating below is enforced by the enclave:
 * the server merely transports ciphertexts and can never over-reveal.
 *
 * op = "encrypt": encrypts pre-built chunk envelopes. Each envelope seals
 *   its own thresholds + vault addresses INSIDE the ciphertext, so they
 *   cannot be tampered with after the fact.
 *
 * op = "decrypt": verifies the viewer's wallet signature (ed25519, ≤10 min
 *   old), checks LEAK holding + per-chunk vault thresholds against live
 *   Solana state, and returns ONLY the chunks the market currently allows.
 *
 * Identity note: the action is cached/addressed by its IPFS hash — any
 * change to this source is a different action.
 */
export const LADDER_ACTION_CODE = `
async function main(p) {
  var A = Lit.Actions;
  var encryptFn = A.encrypt || A.Encrypt;
  var decryptFn = A.decrypt || A.Decrypt;

  if (p.op === "encrypt") {
    var ciphertexts = [];
    for (var i = 0; i < p.messages.length; i++) {
      ciphertexts.push(await encryptFn({ pkpId: p.pkpId, message: p.messages[i] }));
    }
    return { ciphertexts: ciphertexts };
  }

  if (p.op === "decrypt") {
    var authSig = p.authSig;

    // 1. Freshness: the canonical Lit auth message embeds an ISO timestamp
    var m = /at (.+)$/.exec(authSig.signedMessage || "");
    var ts = m ? Date.parse(m[1]) : NaN;
    if (!(isFinite(ts) && Math.abs(Date.now() - ts) < 600000)) {
      return { error: "stale or malformed auth signature" };
    }

    // 2. Verify the ed25519 wallet signature (hex sig, base58 address)
    function b58decode(s) {
      var ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      var n = 0n;
      for (var c of s) {
        var idx = ALPHA.indexOf(c);
        if (idx < 0) throw new Error("bad base58");
        n = n * 58n + BigInt(idx);
      }
      var out = [];
      while (n > 0n) { out.push(Number(n & 255n)); n >>= 8n; }
      for (var c2 of s) { if (c2 !== "1") break; out.push(0); }
      return new Uint8Array(out.reverse());
    }
    function hexBytes(s) {
      var arr = s.match(/.{2}/g) || [];
      return new Uint8Array(arr.map(function (h) { return parseInt(h, 16); }));
    }
    var verified = false;
    try {
      var pub = await crypto.subtle.importKey(
        "raw", b58decode(authSig.address), { name: "Ed25519" }, false, ["verify"]
      );
      verified = await crypto.subtle.verify(
        "Ed25519", pub, hexBytes(authSig.sig),
        new TextEncoder().encode(authSig.signedMessage)
      );
    } catch (e) {
      return { error: "ed25519 verification unavailable: " + (e && e.message) };
    }
    if (!verified) return { error: "invalid auth signature" };

    // 3. Live chain reads
    async function rpc(method, params) {
      var r = await fetch(p.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      });
      var j = await r.json();
      if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
      return j.result;
    }

    var accts = await rpc("getTokenAccountsByOwner", [
      authSig.address, { mint: p.leakMint }, { encoding: "jsonParsed" },
    ]);
    var held = 0;
    var list = (accts && accts.value) || [];
    for (var a = 0; a < list.length; a++) {
      var amt = list[a].account && list[a].account.data && list[a].account.data.parsed
        && list[a].account.data.parsed.info && list[a].account.data.parsed.info.tokenAmount;
      held += Number((amt && amt.amount) || 0);
    }
    if (!(held > 0)) return { error: "ACCESS_DENIED_NO_LEAK" };

    var vaultCache = {};
    async function vaultBal(v) {
      if (!(v in vaultCache)) {
        try {
          var r = await rpc("getTokenAccountBalance", [v]);
          vaultCache[v] = BigInt((r && r.value && r.value.amount) || "0");
        } catch (e2) { vaultCache[v] = 0n; }
      }
      return vaultCache[v];
    }

    // 4. Decrypt inside the TEE; gate the OUTPUT on the sealed thresholds
    var chunks = [];
    for (var ci = 0; ci < p.ciphertexts.length; ci++) {
      var env;
      try {
        env = JSON.parse(await decryptFn({ pkpId: p.pkpId, ciphertext: p.ciphertexts[ci] }));
      } catch (e3) {
        chunks.push({ index: ci, unlocked: false });
        continue;
      }
      var ok = true;
      if (ok && env.fl) ok = (await vaultBal(env.l1v)) >= BigInt(env.fl);
      if (ok && env.ce) ok = (await vaultBal(env.l2v)) < BigInt(env.ce);
      chunks.push(ok
        ? { index: ci, unlocked: true, data: env.data }
        : { index: ci, unlocked: false });
    }
    return { chunks: chunks };
  }

  return { error: "unknown op" };
}
`;
