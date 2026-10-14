import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const payload = join(here, "..", "dist-installed");
const source = join(payload, "src");
const manifest = join(payload, "src-manifest.json");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`source staging: invalid HEAD '${commit}'`);

const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
if (dirty) throw new Error(`source staging requires a clean checkout:\n${dirty}`);

rmSync(source, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
// The archive streams through memory into tar; the tree is ~22 MB, so no scratch file is needed.
const archive = execFileSync("git", ["archive", "--format=tar", commit], {
  cwd: repo,
  maxBuffer: 1 << 30,
});
execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
if (!existsSync(join(source, "Pe.Tools.slnx")))
  throw new Error("source staging: extracted archive has no Pe.Tools.slnx");
writeFileSync(manifest, `${JSON.stringify({ commit }, null, 2)}\n`);
console.log(`staged tracked source ${commit} -> ${source}`);
