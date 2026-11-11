/**
 * Adding a route runs one step, `codegen:routes`, and that step can never leave the ops-catalog hash
 * stale without a red check: nothing it writes is hashed (`ops-catalog-hash.ts`), so a route edit
 * moves no digest, and a C# op edit still reddens `ops-catalog-hash.ts` in the gate.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { hashedSources } from "../../../packages/host-contracts/scripts/ops-catalog-hash.ts";
import { ROUTES_CS } from "../../../packages/agent-contracts/scripts/route-links-cs.ts";

const repo = resolve(import.meta.dirname, "../../../..");
const generator = readFileSync(resolve(repo, "ts/apps/web/scripts/route-graphs.ts"), "utf8");

test("codegen:routes writes the C# launch rows itself", () => {
  expect(generator.includes("agent-contracts/scripts/route-links-cs.ts"), "route-graphs.ts no longer runs route-links-cs.ts").toBe(true);
});

test("no file codegen:routes writes is inside the ops-catalog hash", () => {
  const hashed = new Set(hashedSources());
  const written = [relative(repo, ROUTES_CS).replaceAll("\\", "/")];
  expect(hashed.size, "the hash scope lists no C# source").toBeGreaterThan(100);
  expect(written.filter((path) => hashed.has(path))).toEqual([]);
  // Any other C# the generator names is written by it too, and must stay outside the digest.
  const named = [...generator.matchAll(/dotnet\/[\w./-]+\.cs/g)].map((match) => match[0]);
  expect(named.filter((path) => hashed.has(path))).toEqual([]);
});
