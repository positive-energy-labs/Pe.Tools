/**
 * The ops-catalog drift hash. `host-ops.generated.ts` is projected from the dotnet graph, so a
 * dotnet edit that forgets to regenerate is drift. Rebuilding dotnet to notice took 200 to 330 s per
 * guard run; hashing every C# source takes milliseconds and reddens on the same edits.
 *
 *   --write   record the digest of every existing tracked or untracked dotnet/**\/*.cs outside *.Tests beside the artifact
 *   (none)    exit 1 when the recorded digest differs from the sources; the fix is `pnpm codegen`
 *
 * Git-listed and nonignored, hashed as git blobs: build output stays outside the digest.
 * `git hash-object` applies the same eol normalization in every checkout. New C# files and
 * uncommitted edits change the digest before commit; deleted tracked files are omitted.
 *
 * ponytail: any C# edit, op or not, demands one regen. A narrower hash needs the op graph, which
 * only the dotnet build knows.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SHA = resolve(HERE, "../src/generated/ops-catalog.sha");

// Both calls run from the repo root: `hash-object --stdin-paths` reads paths relative to it.
const sources = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "dotnet"],
      { cwd: ROOT },
    )
      .toString("utf8")
      .split("\0")
      .filter((f) => f.endsWith(".cs") && !/\.Tests\//.test(f) && existsSync(resolve(ROOT, f))),
  ),
].sort();
const blobs = execFileSync("git", ["hash-object", "--stdin-paths"], {
  cwd: ROOT,
  input: `${sources.join("\n")}\n`,
})
  .toString("utf8")
  .trim()
  .split("\n");
const hash = createHash("sha256");
sources.forEach((f, i) => {
  hash.update(f);
  hash.update(blobs[i]!);
});
const now = hash.digest("hex");

if (process.argv.includes("--write")) {
  writeFileSync(SHA, `${now}\n`);
} else if (readFileSync(SHA, "utf8").trim() !== now) {
  console.error(
    `ops-catalog: dotnet sources changed since host-ops.generated.ts was generated. Run \`pnpm codegen\` in ts/packages/host-contracts and commit both files.`,
  );
  process.exit(1);
}
