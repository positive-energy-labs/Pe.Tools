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
  const target = ["origin/main", "main"].find((ref) => {
    try {
      git("rev-parse", "--verify", `refs/${ref === "main" ? "heads" : "remotes"}/${ref}`);
      return true;
    } catch {
      return false;
    }
  });
  let ref = target ? git("merge-base", "HEAD", target) : "HEAD";
  console.log(
    `effect islands: ${target ? `merge-base HEAD ${target}` : "HEAD (no origin/main or main)"} = ${ref}`,
  );
  // Before main adopts this guard, pin its introduction rather than trusting mutable HEAD.
  if (!git("ls-tree", "--full-tree", ref, "--", baselinePath)) {
    const introduction = git(
      "log",
      "--reverse",
      "--format=%H",
      "--diff-filter=A",
      "HEAD",
      "--",
      `:(top)${baselinePath}`,
    ).split("\n")[0];
    if (!introduction) throw new Error(`No committed effect islands baseline at ${ref}`);
    console.log(`effect islands: baseline absent at ${ref}; using introduction ${introduction}`);
    ref = introduction;
  }
  return { baseline: JSON.parse(git("show", `${ref}:${baselinePath}`)) as Islands, ref };
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
