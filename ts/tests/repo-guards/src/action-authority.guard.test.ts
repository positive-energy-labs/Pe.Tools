import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const src = resolve(import.meta.dirname, "../../../packages/mcps/src");

test("raw Work reads stay inside route-workspace internals", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "apps", "packages"], {cwd: root, encoding:"utf8"}).trim().split(/\r?\n/);
  const offenders = paths.flatMap(path => {
    if (!/\.tsx?$/.test(path) || /\.test[.-]|\/tests\//.test(path) || path === "packages/runtime/src/route-workspace.ts") return [];
    const source = readFileSync(resolve(root, path), "utf8");
    return [...source.matchAll(/\.\s*readRaw\s*\(/g)].map(match => `${path}:${source.slice(0, match.index).split("\n").length}`);
  });
  expect(offenders).toEqual([]);
});

test("Pea has one capability admission door", () => {
  const owners = readdirSync(src, { recursive: true })
    .filter((path) => String(path).endsWith(".ts"))
    .flatMap((path) =>
      [
        ...readFileSync(resolve(src, String(path)), "utf8").matchAll(/function runCapability\b/g),
      ].map(() => String(path).replaceAll("\\", "/")),
    );
  expect(owners).toEqual(["shared/admission.ts"]);
});

test("production workspace acquisitions carry context", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "apps", "packages"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/)
    .filter(path => /\.tsx?$/.test(path) && !/\.test[.-]|\/tests\//.test(path) && path !== "packages/runtime/src/route-workspace.ts");
  const candidates = paths.filter(path => /\.\s*(?:view|read|subscribe)\s*\(/.test(readFileSync(resolve(root, path), "utf8")));
  const program = ts.createProgram(candidates.map(path => resolve(root, path)), {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true, skipLibCheck: true, noEmit: true, strict: true, jsx: ts.JsxEmit.ReactJSX,
  });
  const checker = program.getTypeChecker(), offenders: string[] = [];
  for (const path of candidates) {
    const source = program.getSourceFile(resolve(root, path))!;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node.expression.expression));
        if (type.getSymbol()?.name === "RouteWorkspace" && ["view", "read", "subscribe"].includes(method)) {
          const required = method === "subscribe" ? 2 : 3;
          const context = node.arguments[required - 1];
          const contextType = context && checker.getTypeAtLocation(context);
          const maybeAbsent = (type: ts.Type): boolean =>
            !!(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) || (type.isUnion() && type.types.some(maybeAbsent));
          if (!contextType || maybeAbsent(contextType))
            offenders.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${method}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(offenders).toEqual([]);
}, 30_000);
