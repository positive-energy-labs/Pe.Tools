import { execFileSync } from "node:child_process";
import { tsRoot, type Islands } from "./effect-islands-census.ts";

const baselinePath = "ts/tests/repo-guards/src/effect-islands.baseline.json";

export function trustedBaseline(cwd = tsRoot): { baseline: Islands; ref: string } {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  // Only Git-detected renames inherit a cap; copies and additions remain new files.
  const rename = (from: string, to: string, islands: Islands): Islands => {
    const changes = git("diff", "-M", "--name-status", "-z", "--no-relative", from, to).split("\0");
    const renames = new Map<string, string>();
    for (let i = 0; i < changes.length; ) {
      const status = changes[i++];
      const oldPath = changes[i++];
      if (!status?.startsWith("R")) continue;
      const newPath = changes[i++];
      if (oldPath?.startsWith("ts/") && newPath?.startsWith("ts/"))
        renames.set(oldPath.slice(3), newPath.slice(3));
    }
    const renamed: Islands = { src: {}, tests: {} };
    for (const kind of ["src", "tests"] as const)
      for (const [file, count] of Object.entries(islands[kind]))
        renamed[kind][renames.get(file) ?? file] = count;
    return renamed;
  };
  // Trust every committed version reachable from HEAD, oldest first, each capped by the ones before
  // it. merge-base HEAD main is HEAD on main, so it let a committed raise become its own cap.
  const versions = git(
    "log",
    "--reverse",
    "--topo-order",
    "--format=%H",
    "HEAD",
    "--",
    `:(top)${baselinePath}`,
  )
    .split("\n")
    .filter(Boolean);
  if (!versions.length) throw new Error("No committed effect islands baseline");
  const show = (ref: string): Islands => JSON.parse(git("show", `${ref}:${baselinePath}`));
  let cap = show(versions[0]!);
  for (const [i, ref] of versions.entries()) {
    const prior = rename(versions[i - 1] ?? ref, ref, cap);
    cap = show(ref);
    for (const kind of ["src", "tests"] as const)
      for (const [file, count] of Object.entries(cap[kind]))
        cap[kind][file] = Math.min(count, prior[kind][file] ?? 0);
  }
  const ref = versions.at(-1)!;
  console.log(`effect islands: ${versions.length} committed baselines, newest ${ref}`);
  return { baseline: rename(ref, "HEAD", cap), ref };
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
