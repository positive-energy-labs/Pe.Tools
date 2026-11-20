// Route closure (kernel crusade 2, D1 in docs/features/routes/CONTRACTS.md). Three rules over
// production files under apps/web/src (`.test.`, `.test-support.`, `.fixture.` exempt; the
// `design-system` window exempt both ways):
//   1. no route folder imports another route folder;
//   2. no shared web folder (no `route.ts`, including files at the src root) imports a route folder;
//   3. no route folder reaches the host directly: it neither imports nor calls `peClient`, `callOp`,
//      `callCompose`, `callHostRpc`, `hostFetch`, nor calls `fetch(`.
// A route folder is a top-level directory under apps/web/src that holds `route.ts`, or a product's
// `ts/products/<product>/web` that does (ADR 0046). A web file keeps its src-relative key; a product
// file is keyed from `ts`, as `products/<product>/web/...`.
// The edges that stood at f38543da are a frozen list (route-closure.baseline.json) that only shrinks.
// `node src/route-closure-census.ts` prints the census; `--tighten` rewrites the baseline, refusing growth.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TS = resolve(import.meta.dirname, "../../..");
const WEB_KEY = "apps/web/src/";
const WEB = join(TS, WEB_KEY);
import { routeFolderCandidates } from "@pe/web/route-startup";
const EXEMPT = "design-system";
const HOST_DOORS = new Set(["peClient", "callOp", "callCompose", "callHostRpc", "hostFetch"]);
// Exemption (closure rules): a product's `journeys/` is driver-run journey tooling like `.test.`/`.fixture.`,
// not route code; the boundary that holds is that no route source imports a journey (route-closure.guard.test.ts).
export const isProduction = (path: string) =>
  /\.tsx?$/.test(path) && !/\.d\.ts$|\.test\.|\.test-support\.|\.fixture\.|\/journeys\//.test(path);

/** Folder of a key: top-level for a web file ("." at the src root), `products/<product>/web` for a product's. */
const folderOf = (path: string) =>
  path.startsWith("products/") ? path.split("/", 3).join("/") : path.includes("/") ? path.split("/")[0]! : ".";

/** Key of a specifier's target, or null when it leaves both apps/web/src and ts/products. */
function target(from: string, spec: string): string | null {
  if (/^[#@]\//.test(spec)) return spec.slice(2).replace(/\.[cm]?[jt]sx?$/, "");
  if (!spec.startsWith(".")) return null;
  // Resolved from `ts`, so a web file can reach a product folder and the reverse.
  const full = posix.join(posix.dirname(from.startsWith("products/") ? from : WEB_KEY + from), spec);
  const key = full.startsWith(WEB_KEY) ? full.slice(WEB_KEY.length) : full.startsWith("products/") ? full : null;
  return key?.replace(/\.[cm]?[jt]sx?$/, "") ?? null;
}

/**
 * Offenders in `sources` (src-relative path -> text), each a stable key:
 * `<file> -> <target module>` for rules 1 and 2, `<file> uses <door>` for rule 3.
 */
export function closureCensus(sources: Record<string, string>, routes: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const [file, text] of Object.entries(sources)) {
    if (!isProduction(file)) continue;
    const from = folderOf(file);
    if (from === EXEMPT) continue;
    const inRoute = routes.has(from);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edge = (spec: string) => {
      const to = target(file, spec);
      if (to === null) return;
      const folder = folderOf(to);
      if (folder !== from && folder !== EXEMPT && routes.has(folder)) found.add(`${file} -> ${to}`);
    };
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        edge(node.moduleSpecifier.text);
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
        if (inRoute && bindings && ts.isNamedImports(bindings))
          for (const item of bindings.elements)
            if (HOST_DOORS.has((item.propertyName ?? item.name).text)) found.add(`${file} uses ${(item.propertyName ?? item.name).text}`);
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) edge(node.arguments[0].text);
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        if (inRoute && name && (HOST_DOORS.has(name) || (name === "fetch" && ts.isIdentifier(callee)))) found.add(`${file} uses ${name}`);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        edge(node.argument.literal.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...found].sort();
}

const productWebs = () =>
  routeFolderCandidates(resolve(TS, "..")).map((path) => relative(TS, path).replaceAll("\\", "/")).filter((key) => key.startsWith("products/"));

export const routeFolders = (): Set<string> =>
  new Set([
    ...readdirSync(WEB, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== EXEMPT && existsSync(join(WEB, e.name, "route.ts")))
      .map((e) => e.name),
    ...productWebs().filter((key) => existsSync(join(TS, key, "route.ts"))),
  ]);

/** Prune installed dependencies before descending, including workspace links on Windows. */
export function webSourceFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "node_modules" || entry.name === ".git") return [];
    const path = posix.join(prefix, entry.name);
    return entry.isDirectory() ? webSourceFiles(root, path) : isProduction(path) ? [path] : [];
  });
}

export function webSources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [root, prefix] of [[WEB, ""], ...productWebs().map((key) => [join(TS, key), `${key}/`])] as [string, string][]) {
    if (!existsSync(root)) continue;
    for (const path of webSourceFiles(root)) {
      out[prefix + path] = readFileSync(join(root, path), "utf8");
    }
  }
  return out;
}

export const BASELINE = join(import.meta.dirname, "route-closure.baseline.json");
export const census = () => closureCensus(webSources(), routeFolders());

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const actual = census();
  if (process.argv.includes("--tighten")) {
    const frozen: string[] = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : actual;
    const grown = actual.filter((edge) => !frozen.includes(edge));
    if (grown.length) throw new Error(`route closure: the frozen list only shrinks; new offenders:\n${grown.join("\n")}`);
    writeFileSync(BASELINE, `${JSON.stringify(actual, null, 2)}\n`);
  }
  console.log(`route closure: ${actual.length} offenders`);
}
