/**
 * The leak.markets "ladder" Lit Action — immutable JS executed inside the
 * Chipotle TEE. This is the ONLY code path that can derive the content key
 * (PKP-scoped), so the gating below is enforced by the enclave.
 *
 * Gating model: PERMISSIONLESS, market-decided. No viewer wallet involved.
 * Each chunk envelope seals { tier index i, tier count k, v1, v2 } inside
 * the ciphertext (tamper-proof), where
 *   v1 = the LEAK curve's BASE vault   (UNSOLD LEAK)
 *   v2 = the content curve's BASE vault (UNSOLD DontLeak)
 * Both are ~1B-supply token counts — the same units by construction.
 * Buying LEAK drains v1 (reveal rises); buying DontLeak drains v2
 * (reveal falls). At decrypt the enclave reads both live and computes
 *     r = sqrt( v2 / (v1 + v2) )
 * returning only the first floor(r·k) tiers — whoever presses the button
 * gets exactly what the market currently reveals (~70% at a fresh 50/50
 * launch under the sqrt skew).
 *
 * op = "encrypt": encrypts pre-built chunk envelopes as-is.
 * op = "decrypt": ratio-gates and returns permitted chunks.
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

    // Decimals-normalized balance of a token account (0 if missing)
    var balCache = {};
    async function uiBal(v) {
      if (!(v in balCache)) {
        try {
          var r2 = await rpc("getTokenAccountBalance", [v]);
          var val = r2 && r2.value;
          balCache[v] = val
            ? Number(val.uiAmountString != null ? val.uiAmountString : (val.uiAmount || 0))
            : 0;
        } catch (e) { balCache[v] = 0; }
      }
      return balCache[v];
    }

    // Reveal ratio per vault pair, cached:
    //   r = sqrt( unsoldDontLeak / (unsoldLeak + unsoldDontLeak) )
    var rCache = {};
    async function ratio(v1, v2) {
      var key = v1 + "|" + v2;
      if (!(key in rCache)) {
        var unsoldLeak = await uiBal(v1);
        var unsoldDont = await uiBal(v2);
        var total = unsoldLeak + unsoldDont;
        rCache[key] = total > 0
          ? Math.sqrt(Math.max(0, Math.min(1, unsoldDont / total)))
          : 0;
      }
      return rCache[key];
    }

    var chunks = [];
    var rOut = null;
    for (var ci = 0; ci < p.ciphertexts.length; ci++) {
      var env;
      try {
        env = JSON.parse(await decryptFn({ pkpId: p.pkpId, ciphertext: p.ciphertexts[ci] }));
      } catch (e3) {
        chunks.push({ index: ci, unlocked: false });
        continue;
      }
      var ok = false;
      if (env.k && env.v1 && env.v2) {
        var r3 = await ratio(env.v1, env.v2);
        rOut = r3;
        ok = env.i < Math.floor(r3 * env.k + 1e-9);
      }
      chunks.push(ok
        ? { index: ci, unlocked: true, data: env.data }
        : { index: ci, unlocked: false });
    }
    return { chunks: chunks, r: rOut };
  }

  return { error: "unknown op" };
}
`;
