import { execFileSync } from "node:child_process";
import { tsRoot, type Islands } from "./effect-islands-census.ts";

const baselinePath = "ts/tests/repo-guards/src/effect-islands.baseline.json";

export function trustedBaseline(cwd = tsRoot): { baseline: Islands; ref: string } {
  // Spawn count is the cost here (process creation dominates, and a loaded machine multiplies it), so
  // the whole history is read in three spawns however many baseline versions exist: log, cat-file, diff-tree.
  const git = (args: string[], input?: string) =>
    execFileSync("git", args, { cwd, input, stdio: ["pipe", "pipe", "ignore"] });
  // Trust every committed version reachable from HEAD, oldest first, each capped by the ones before
  // it. merge-base HEAD main is HEAD on main, so it let a committed raise become its own cap.
  const versions = git([
    "log",
    "--reverse",
    "--topo-order",
    "--format=%H",
    "HEAD",
    "--",
    `:(top)${baselinePath}`,
  ])
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!versions.length) throw new Error("No committed effect islands baseline");
  // cat-file --batch answers `<sha> <type> <bytes>\n<content>\n` per request, in request order: every
  // baseline blob, then HEAD itself (diff-tree --stdin reads shas, not names).
  const raw = git(
    ["cat-file", "--batch"],
    [...versions.map((ref) => `${ref}:${baselinePath}`), "HEAD"].join("\n") + "\n",
  );
  const objects: { sha: string; body: Buffer }[] = [];
  for (let at = 0; objects.length <= versions.length; ) {
    const eol = raw.indexOf("\n", at);
    const [sha = "", , bytes] = raw.subarray(at, eol).toString("utf8").split(" ");
    const size = Number(bytes);
    if (!Number.isInteger(size)) throw new Error("A committed effect islands baseline is missing");
    objects.push({ sha, body: raw.subarray(eol + 1, eol + 1 + size) });
    at = eol + 1 + size + 1;
  }
  const blobs: Islands[] = objects
    .slice(0, -1)
    .map(({ body }) => JSON.parse(body.toString("utf8")));
  const ref = versions.at(-1)!;
  const headSha = objects.at(-1)!.sha;
  // Only Git-detected renames inherit a cap; copies and additions remain new files. One diff-tree reads
  // every consecutive pair plus newest -> HEAD, each as `<commit> <its parent>` (the --stdin form that
  // diffs parent -> commit). Its -z stream is a 40-hex header naming the commit (none for an empty diff)
  // followed by that diff's status/path records.
  const chain = headSha === ref ? versions : [...versions, headSha];
  const stream = git(
    ["diff-tree", "--stdin", "-r", "-M", "--name-status", "-z", "--no-relative"],
    chain
      .slice(1)
      .map((to, i) => `${to} ${chain[i]}`)
      .join("\n") + "\n",
  )
    .toString("utf8")
    .split("\0");
  const renames = new Map<string, Map<string, string>>();
  for (let i = 0, to = ""; i < stream.length; ) {
    const token = stream[i++]!;
    if (/^[0-9a-f]{40}$/.test(token)) {
      to = token;
      renames.set(to, new Map());
    } else if (!token.startsWith("R")) {
      if (token) i++; // A, M, D and T carry one path; R and C carry two
    } else {
      const [oldPath, newPath] = [stream[i++], stream[i++]];
      if (oldPath?.startsWith("ts/") && newPath?.startsWith("ts/"))
        renames.get(to)!.set(oldPath.slice(3), newPath.slice(3));
    }
  }
  // Renames into `to`; the first version has no predecessor, so it has no entry.
  const rename = (to: string | undefined, islands: Islands): Islands => {
    const map = (to && renames.get(to)) || new Map<string, string>();
    const renamed: Islands = { src: {}, tests: {} };
    for (const kind of ["src", "tests"] as const)
      for (const [file, count] of Object.entries(islands[kind]))
        renamed[kind][map.get(file) ?? file] = count;
    return renamed;
  };
  let cap = blobs[0]!;
  for (const [i, version] of versions.entries()) {
    const prior = rename(version, cap);
    cap = blobs[i]!;
    for (const kind of ["src", "tests"] as const)
      for (const [file, count] of Object.entries(cap[kind]))
        cap[kind][file] = Math.min(count, prior[kind][file] ?? 0);
  }
  console.log(`effect islands: ${versions.length} committed baselines, newest ${ref}`);
  // HEAD == newest version means no later diff; its own key would replay the previous pair.
  return { baseline: rename(headSha === ref ? undefined : headSha, cap), ref };
}

export function increases(actual: Islands, cap: Islands, kind: keyof Islands): string[] {
  return Object.entries(actual[kind])
    .filter(([file, count]) => count > (cap[kind][file] ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${cap[kind][file] ?? 0}`);
}

export function tightenedBaseline(
  actual: Islands,
  baseline: Islands,
  trusted: Islands,
  isNew: (file: string) => boolean,
): Islands {
  const next: Islands = { src: {}, tests: {} };
  for (const kind of ["src", "tests"] as const) {
    for (const [file, count] of Object.entries(actual[kind])) {
      const cap = baseline[kind][file];
      const trustedCap = trusted[kind][file];
      if (
        (cap === undefined && !(count === 0 && isNew(file))) ||
        (cap !== undefined && count > cap) ||
        (trustedCap !== undefined && count > trustedCap) ||
        (trustedCap === undefined && !(count === 0 && isNew(file)))
      )
        throw new Error(
          `${file}: ${cap ?? "none"} -> ${count}, trusted ${trustedCap ?? "none"} (refused: islands only shrink)`,
        );
      next[kind][file] = count;
    }
  }
  return next;
}
