/**
 * The ops-catalog drift hash. `host-ops.generated.ts` is projected from the dotnet graph, so a
 * dotnet edit that forgets to regenerate is drift. Rebuilding dotnet to notice took 200 to 330 s per
 * guard run; hashing every C# source takes milliseconds and reddens on the same edits.
 *
 *   --write   record the hash of dotnet/**\/*.cs (tests, obj, bin excluded) beside the artifact
 *   (none)    exit 1 when the recorded hash differs from the sources; the fix is `pnpm codegen`
 *
 * ponytail: any C# edit, op or not, demands one regen. A narrower hash needs the op graph, which
 * only the dotnet build knows.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTNET = resolve(HERE, "../../../../dotnet");
const SHA = resolve(HERE, "../src/generated/ops-catalog.sha");

const hash = createHash("sha256");
for (const f of readdirSync(DOTNET, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".cs") && !/[/](obj|bin)[/]|\.Tests[/]/.test(f))
  .sort()) {
  hash.update(relative(DOTNET, join(DOTNET, f)).replaceAll("\\", "/"));
  hash.update(readFileSync(join(DOTNET, f)));
}
const now = hash.digest("hex");

if (process.argv.includes("--write")) {
  writeFileSync(SHA, `${now}\n`);
} else if (readFileSync(SHA, "utf8").trim() !== now) {
  console.error(
    `ops-catalog: dotnet sources changed since host-ops.generated.ts was generated. Run \`pnpm codegen\` in ts/packages/host-contracts and commit both files.`,
  );
  process.exit(1);
}
