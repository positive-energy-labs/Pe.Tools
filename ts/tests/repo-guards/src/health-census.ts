// Five counts over production source (.ts, .tsx, .cs), each a ratchet: escape casts, lint and
// type suppressions, TODO marks, files over 600 lines, and filesystem mutations in host files.
// Before this guard they had none and rose in steps at landings (casts 101 to 151 and
// suppressions 57 to 106 in two weeks).
// `node src/health-census.ts` prints the census; `--tighten` lowers the baseline to it.
// ponytail: the first three are lines matched by a regex, not the type checker. A count that
// needs the checker gets its own census, as test-casts has.
// `fsWrites` (kernel crusade 2, slice 1 / ST5) is a syntax-tree count: one per call that mutates
// the filesystem through node:fs, node:fs/promises or an Effect `FileSystem`, in production files
// of the host and the packages it stores through. It ratchets per file, not by total: a write
// moved into a file is a new owner of a stored path, so no file may rise and a new file starts at 0.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type Count = Record<string, number>;
export type Health = { casts: Count; suppressions: Count; todos: Count; longFiles: Count; fsWrites: Count };

/** Ratchets that hold per file: no file may rise, whatever the total does. */
export const PER_FILE = ["fsWrites"] as const satisfies readonly (keyof Health)[];

/**
 * The doors: files a per-file count may rise in, because writes consolidate into them (the store is
 * the one write door, routes CONTRACTS K-A2). Their calls still count toward the total.
 */
export const OWNERS: Record<(typeof PER_FILE)[number], readonly string[]> = {
  fsWrites: ["ts/packages/host-contracts/src/store.ts"],
};

/** Per-file rises outside the named owners. */
export const perFileRises = (name: (typeof PER_FILE)[number], actual: Count, baseline: Count) =>
  rises(actual, baseline).filter((line) => !OWNERS[name].some((owner) => line.startsWith(`${owner}:`)));

const FS_SCOPE = /^ts\/(apps\/host|packages\/(host-contracts|host-internal|runtime))\//;
const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const NODE_MUTATORS = new Set(
  ["writeFile", "appendFile", "rename", "rm", "rmdir", "unlink", "mkdir", "mkdtemp", "copyFile", "cp", "symlink", "link", "truncate", "chmod", "utimes"]
    .flatMap((name) => [name, `${name}Sync`])
    .concat("createWriteStream"),
);
const EFFECT_MUTATORS = new Set([
  "writeFile", "writeFileString", "remove", "rename", "makeDirectory", "makeTempDirectory", "makeTempDirectoryScoped",
  "makeTempFile", "makeTempFileScoped", "copy", "copyFile", "symlink", "link", "truncate", "chmod", "utimes", "sink",
]);

/**
 * Calls that mutate the filesystem: a named node:fs import called directly, a member of a
 * namespace, default or `promises` binding of node:fs, or a member of a value bound from
 * `yield* FileSystem.FileSystem`.
 * ponytail: bindings by syntax in one file; an fs handle passed in as a parameter is not seen.
 * Upgrade to the type checker if writes start arriving through injected handles.
 */
export function fsWriteCount(path: string, text: string): number {
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const direct = new Set<string>();
  const nodeHandles = new Set<string>();
  const effectHandles = new Set<string>();
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && FS_MODULES.has(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause?.name) nodeHandles.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) nodeHandles.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements) {
          const imported = (item.propertyName ?? item.name).text;
          if (imported === "promises") nodeHandles.add(item.name.text);
          else if (NODE_MUTATORS.has(imported)) direct.add(item.name.text);
        }
    } else if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isYieldExpression(node.initializer) && node.initializer.asteriskToken &&
      node.initializer.expression?.getText(ast) === "FileSystem.FileSystem"
    ) {
      effectHandles.add(node.name.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && direct.has(callee.text)) count++;
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const [handle, member] = [callee.expression.text, callee.name.text];
        if ((nodeHandles.has(handle) && NODE_MUTATORS.has(member)) || (effectHandles.has(handle) && EFFECT_MUTATORS.has(member))) count++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return count;
}

const repoRoot = resolve(import.meta.dirname, "../../../..");
const LONG = 600;
const lines: Record<Exclude<keyof Health, "longFiles" | "fsWrites">, RegExp> = {
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
  const health: Health = { casts: {}, suppressions: {}, todos: {}, longFiles: {}, fsWrites: {} };
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter((path) => isProduction(path) && existsSync(join(repoRoot, path)))
    .sort();
  for (const file of files) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    if (FS_SCOPE.test(file) && /\.tsx?$/.test(file)) {
      const writes = fsWriteCount(file, source);
      if (writes) health.fsWrites[file] = writes;
    }
    const text = source.split("\n");
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
    for (const name of PER_FILE)
      if (baseline?.[name] && perFileRises(name, actual[name], baseline[name]).length)
        throw new Error(
          `health: ${name} rose per file; a ratchet only tightens.\n${perFileRises(name, actual[name], baseline[name]).join("\n")}`,
        );
    for (const name of names)
      if (baseline?.[name] && total(actual[name]) > total(baseline[name]))
        throw new Error(
          `health: ${name} ${total(actual[name])} exceeds the baseline ${total(baseline[name])}; a ratchet only tightens.\n${rises(actual[name], baseline[name]).join("\n")}`,
        );
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  }
  console.log(names.map((name) => `${name} ${total(actual[name])}`).join(", "));
}
