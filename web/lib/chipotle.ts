/**
 * Chipotle (Lit Protocol v3) REST client for the leak.markets ladder action.
 *
 * Lit's datil network — which the original integration targeted — was shut
 * down on 2026-02-25 (naga followed on 2026-04-01). Chipotle is the live
 * production network: an HTTP API where immutable Lit Actions run in a TEE
 * and are the only code that can use PKP-derived encryption keys.
 *
 * Required env (see web/scripts/chipotle-setup.mjs):
 *   LIT_API_KEY — account/usage key from /new_account (fund via Dashboard)
 *   LIT_PKP_ID  — wallet (PKP) created with /create_wallet
 */
import { LADDER_ACTION_CODE } from "./ladderAction";

const BASE = process.env.LIT_API_BASE ?? "https://api.chipotle.litprotocol.com/core/v1";

export function litEnv(): { apiKey: string; pkpId: string } {
  const apiKey = process.env.LIT_API_KEY;
  const pkpId  = process.env.LIT_PKP_ID;
  if (!apiKey || !pkpId) {
    throw new Error(
      "Lit Chipotle not configured: set LIT_API_KEY and LIT_PKP_ID " +
      "(run `node web/scripts/chipotle-setup.mjs` to provision, then fund the account)",
    );
  }
  return { apiKey, pkpId };
}

interface LitActionResponse {
  has_error: boolean;
  logs:      string;
  response:  unknown;
}

/** Execute the ladder action in the Chipotle TEE and return its result. */
export async function runLadderAction<T>(jsParams: Record<string, unknown>): Promise<T> {
  const { apiKey } = litEnv();
  const res = await fetch(`${BASE}/lit_action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ code: LADDER_ACTION_CODE, js_params: jsParams }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Chipotle /lit_action HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  // ErrMessage responses are plain strings
  if (typeof body === "string") throw new Error(`Chipotle: ${body}`);

  const lit = body as LitActionResponse;
  if (lit.has_error) {
    throw new Error(`Lit Action error: ${String(lit.logs).slice(0, 500)}`);
  }
  const out = typeof lit.response === "string" ? JSON.parse(lit.response) : lit.response;
  if (out && typeof out === "object" && "error" in (out as Record<string, unknown>)) {
    throw new Error(String((out as Record<string, unknown>).error));
  }
  return out as T;
}
