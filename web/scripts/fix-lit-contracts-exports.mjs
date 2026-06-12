/**
 * Fixes an upstream packaging bug in @lit-protocol/contracts that crashes
 * the Lit SDK on Node < 22.12 (e.g. Vercel's default function runtime):
 *
 * The package is ESM ("type": "module") but its exports map points the
 * `require` condition of entries like "./prod/datil.js" at the ESM .js
 * file, so CJS consumers (@lit-protocol/constants' mappers.js) crash with
 * ERR_REQUIRE_ESM. The shipped .cjs siblings exist but export the bare
 * object (module.exports = {config, data}) while consumers expect the
 * ESM named export (e.g. `datil`), so simply repointing `require` at the
 * .cjs silently yields `undefined` and "Unsupported network: datil".
 *
 * This generates a `<name>.compat.cjs` shim per entry that re-exports the
 * .cjs object under the ESM export name, and points the `require`
 * condition at it. Runs from `postinstall`; idempotent.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);
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
    if (!value || typeof value !== "object" || typeof value.import !== "string") continue;
    if (!value.import.endsWith(".js")) continue;

    const esmAbs = join(root, value.import);
    const cjsRel = value.import.slice(0, -3) + ".cjs";
    const cjsAbs = join(root, cjsRel);
    if (!existsSync(esmAbs) || !existsSync(cjsAbs)) continue;

    // The broken entries each declare exactly one `export const <name>`.
    const names = [...readFileSync(esmAbs, "utf8").matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
    if (names.length !== 1) continue;
    const name = names[0];

    // If the .cjs already has the named export (a real CJS build), point at it.
    let cjsMod;
    try { cjsMod = requireCjs(cjsAbs); } catch { continue; }
    if (cjsMod && typeof cjsMod === "object" && name in cjsMod) {
      if (value.require !== cjsRel) { value.require = cjsRel; changed = true; }
      continue;
    }

    // Otherwise generate a shim mapping the ESM export name onto the bare object.
    const shimRel = value.import.slice(0, -3) + ".compat.cjs";
    const shimAbs = join(root, shimRel);
    writeFileSync(shimAbs, `module.exports = { ${name}: require(${JSON.stringify("./" + basename(cjsAbs))}) };\n`);
    if (value.require !== shimRel) { value.require = shimRel; changed = true; }
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    patched++;
    console.log(`[fix-lit-contracts-exports] patched ${pkgPath}`);
  }
}
console.log(`[fix-lit-contracts-exports] done — ${patched} package.json file(s) patched`);
