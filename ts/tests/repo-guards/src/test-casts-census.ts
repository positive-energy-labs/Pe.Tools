// Counts, with the TypeScript checker, the casts in test files whose target type is declared in a
// non-test source file: each one builds a production type without its constructor (purge law).
// `node src/test-casts-census.ts` prints the census; `--tighten` lowers the baseline to it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type TestCasts = { testFiles: number; total: number; byFile: Record<string, number> };

const tsRoot = resolve(import.meta.dirname, "../../..");
const norm = (path: string) => path.replaceAll("\\", "/");
const root = `${norm(tsRoot)}/`;
const rel = (path: string) => norm(path).replace(root, "");

export const isTestFile = (path: string) =>
  /\.(test|spec)\.[cm]?tsx?$/.test(path) ||
  /(^|\/)(tests?|__tests__)\//.test(path) ||
  /(^|\/)test-[^/]*\.tsx?$/.test(path) ||
  /\.guard\./.test(path);
const isProduction = (path: string) => {
  const file = norm(path);
  return file.startsWith(root) && !file.includes("/node_modules/") && !isTestFile(rel(file));
};

const testFiles = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: tsRoot,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter((path) => /\.[cm]?tsx?$/.test(path) && !/\.d\.ts$/.test(path) && isTestFile(path))
    .filter((path) => existsSync(join(tsRoot, path)));

/** Each test file is checked under the nearest tsconfig above it, the one its package checks it with. */
const byConfig = (files: string[]) => {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    let dir = dirname(resolve(tsRoot, file));
    while (!existsSync(join(dir, "tsconfig.json")) && norm(dir).length >= root.length)
      dir = dirname(dir);
    const config = join(dir, "tsconfig.json");
    groups.set(config, [...(groups.get(config) ?? []), resolve(tsRoot, file)]);
  }
  return groups;
};

/** Whether the cast's target names a production declaration, through aliases, unions and type arguments. */
const targetsProduction = (checker: ts.TypeChecker, target: ts.TypeNode) => {
  const declared = (symbol: ts.Symbol | undefined) => {
    const real =
      symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (
      !!real &&
      !real.name.startsWith("__") &&
      !!real.declarations?.some((d) => isProduction(d.getSourceFile().fileName))
    );
  };
  const symbols = (type: ts.Type | undefined, depth = 0): ts.Symbol[] => {
    if (!type || depth > 3) return [];
    const own = type.aliasSymbol
      ? [type.aliasSymbol]
      : type.isUnionOrIntersection()
        ? type.types.flatMap((part) => symbols(part, depth + 1))
        : type.symbol
          ? [type.symbol]
          : [];
    const args =
      type.aliasTypeArguments ??
      ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        ? checker.getTypeArguments(type as ts.TypeReference)
        : []);
    return [...own, ...args.flatMap((arg) => symbols(arg, depth + 1))];
  };
  if (symbols(checker.getTypeFromTypeNode(target)).some(declared)) return true;
  // A target that resolves to an anonymous shape (`{ result: DuctSnapshot }`, `X["nodes"]`) still
  // names production types in its text.
  let named = false;
  const walk = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      (ts.isTypeReferenceNode(node.parent) ||
        ts.isTypeQueryNode(node.parent) ||
        ts.isQualifiedName(node.parent))
    )
      named ||= declared(checker.getSymbolAtLocation(node));
    if (!named) ts.forEachChild(node, walk);
  };
  walk(target);
  return named;
};

export function census(): TestCasts {
  const files = testFiles();
  const byFile: Record<string, number> = {};
  for (const [configPath, group] of byConfig(files)) {
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    const program = ts.createProgram(group, {
      ...config?.options,
      noEmit: true,
      incremental: false,
      tsBuildInfoFile: undefined,
      skipLibCheck: true,
    });
    const checker = program.getTypeChecker();
    for (const file of group) {
      const source = program.getSourceFile(file);
      if (!source) throw new Error(`test-casts census: ${rel(file)} is not in its program`);
      const visit = (node: ts.Node) => {
        if (
          (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
          !ts.isConstTypeReference(node.type) &&
          targetsProduction(checker, node.type)
        )
          byFile[rel(file)] = (byFile[rel(file)] ?? 0) + 1;
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  const sorted = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    testFiles: files.length,
    total: Object.values(sorted).reduce((sum, n) => sum + n, 0),
    byFile: sorted,
  };
}

/** The files whose count rose, as `file: baseline -> actual`. */
export const rises = (actual: TestCasts, baseline: TestCasts) =>
  Object.entries(actual.byFile)
    .filter(([file, count]) => count > (baseline.byFile[file] ?? 0))
    .map(([file, count]) => `${file}: ${baseline.byFile[file] ?? 0} -> ${count}`);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = join(import.meta.dirname, "test-casts.baseline.json");
  const actual = census();
  if (process.argv.includes("--tighten")) {
    const baseline = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as TestCasts)
      : undefined;
    if (baseline && actual.total > baseline.total)
      throw new Error(
        `test-casts: ${actual.total} casts exceed the baseline ${baseline.total}; a ratchet only tightens.\n${rises(actual, baseline).join("\n")}`,
      );
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  }
  console.log(`${actual.total} casts to production types in ${actual.testFiles} test files`);
}
