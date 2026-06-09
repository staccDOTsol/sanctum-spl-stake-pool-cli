// Browser polyfills for @solana/web3.js + spl-token in a non-Next bundle.
import { Buffer } from "buffer";
const g = globalThis as unknown as { Buffer?: unknown; global?: unknown; process?: { env: Record<string, string> } };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) g.process = { env: {} };
