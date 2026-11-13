// Four text counts over production source (.ts, .tsx, .cs), each a ratchet: escape casts,
// lint and type suppressions, TODO marks, and files over 600 lines. Before this guard they had
// none and rose in steps at landings (casts 101 to 151 and suppressions 57 to 106 in two weeks).
// `node src/health-census.ts` prints the census; `--tighten` lowers the baseline to it.
// ponytail: lines matched by a regex, not the type checker. A count that needs the checker gets
// its own census, as test-casts has.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Count = Record<string, number>;
export type Health = { casts: Count; suppressions: Count; todos: Count; longFiles: Count };

const repoRoot = resolve(import.meta.dirname, "../../../..");
const LONG = 600;
const lines: Record<Exclude<keyof Health, "longFiles">, RegExp> = {
  casts: /\bas (any|unknown as)\b|\(dynamic\)|\bas never\b/,
  suppressions:
    /@ts-(ignore|expect-error)|(eslint|oxlint)-disable|#pragma warning disable|SuppressMessage/,
  todos: /\b(TODO|HACK|FIXME|XXX)\b/,
};

export const isProduction = (path: string) =>
  /\.(tsx?|cs)$/.test(path) &&
  !/\.d\.ts$|\.(test|spec|guard|journey|gen|generated)\.|(^|\/)(tests?|__tests__|fixtures?|generated)\/|Tests?\//.test(
    path,
  );

export const total = (count: Count) => Object.values(count).reduce((sum, n) => sum + n, 0);

export function census(): Health {
  const health: Health = { casts: {}, suppressions: {}, todos: {}, longFiles: {} };
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter((path) => isProduction(path) && existsSync(join(repoRoot, path)))
    .sort();
  for (const file of files) {
    const text = readFileSync(join(repoRoot, file), "utf8").split("\n");
    if (text.length > LONG) health.longFiles[file] = 1;
    for (const [name, pattern] of Object.entries(lines)) {
      const hits = text.filter((line) => pattern.test(line)).length;
      if (hits) health[name as keyof typeof lines][file] = hits;
    }
  }
  return health;
}

/** The files whose count rose, as `file: baseline -> actual`. */
export const rises = (actual: Count, baseline: Count) =>
  Object.entries(actual)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(([file, count]) => `${file}: ${baseline[file] ?? 0} -> ${count}`);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = join(import.meta.dirname, "health.baseline.json");
  const actual = census();
  const names = Object.keys(actual) as (keyof Health)[];
  if (process.argv.includes("--tighten")) {
    const baseline = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Health)
      : undefined;
    for (const name of names)
      if (baseline && total(actual[name]) > total(baseline[name]))
        throw new Error(
          `health: ${name} ${total(actual[name])} exceeds the baseline ${total(baseline[name])}; a ratchet only tightens.\n${rises(actual[name], baseline[name]).join("\n")}`,
        );
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  }
  console.log(names.map((name) => `${name} ${total(actual[name])}`).join(", "));
}
