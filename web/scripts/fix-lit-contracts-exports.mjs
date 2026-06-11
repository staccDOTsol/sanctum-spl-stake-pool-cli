/**
 * Fixes an upstream packaging bug in @lit-protocol/contracts that crashes
 * the Lit SDK on Node < 22.12 (e.g. Vercel's default function runtime):
 *
 * The package is ESM ("type": "module") but its exports map points the
 * `require` condition of entries like "./prod/datil.js" at the ESM .js
 * file instead of the .cjs sibling it also ships. CJS consumers
 * (@lit-protocol/constants' mappers.js) then crash with ERR_REQUIRE_ESM.
 *
 * This rewrites each `require` condition to the .cjs file when one exists.
 * Runs from `postinstall`; safe to run repeatedly.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scope   = join(webRoot, "node_modules", "@lit-protocol");

const candidates = [join(scope, "contracts")];
if (existsSync(scope)) {
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(scope, entry.name, "node_modules", "@lit-protocol", "contracts");
    if (existsSync(nested)) candidates.push(nested);
  }
}

let patched = 0;
for (const root of candidates) {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.type !== "module" || typeof pkg.exports !== "object") continue;

  let changed = false;
  for (const value of Object.values(pkg.exports)) {
    if (!value || typeof value !== "object" || typeof value.require !== "string") continue;
    if (!value.require.endsWith(".js")) continue;
    const cjs = value.require.slice(0, -3) + ".cjs";
    if (existsSync(join(root, cjs))) {
      value.require = cjs;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    patched++;
    console.log(`[fix-lit-contracts-exports] patched ${pkgPath}`);
  }
}
console.log(`[fix-lit-contracts-exports] done — ${patched} package.json file(s) patched`);
