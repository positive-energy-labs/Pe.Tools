/**
 * Slice 5a build guards (docs/features/routes/REGISTRY-SHAPE.md): a route's host read lives in its
 * route directory under apps/web/src, so the two builds must be kept apart by edge, not by folder.
 * The host build (from apps/host/src/index.ts) reaches no browser-only module; the web build (from
 * router.tsx (and through routeTree.gen.ts every file route), routes/__root.tsx and the web builtin registry, its `import.meta.glob`s expanded) reaches no host
 * module and no `node:` builtin. Each guard also requires
 * the edge it protects to exist, so it is red until the fill lands and prints why.
 */
import { existsSync, globSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../..");
const slash = (path: string) => path.replaceAll("\\", "/");
const options = (app: string) => {
  const config = ts.readConfigFile(join(root, app, "tsconfig.json"), ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, app)).options;
};

const runtimeImports = (source: ts.SourceFile) => {
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      if (!clause?.isTypeOnly && !(!clause?.name && names && ts.isNamedImports(names) &&
          names.elements.length && names.elements.every((name) => name.isTypeOnly)))
        imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) {
      const names = node.exportClause;
      if (!(names && ts.isNamedExports(names) && names.elements.length &&
          names.elements.every((name) => name.isTypeOnly))) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    // Vite's `import.meta.glob` is an edge too (route/registry.ts reaches every route.ts this way):
    // each match is imported by its relative path.
    else if (ts.isCallExpression(node) && node.expression.getText(source) === "import.meta.glob" &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      for (const match of globSync(node.arguments[0].text, { cwd: dirname(source.fileName) }))
        imports.push(`./${slash(match)}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};

/** Every repo module the build reaches from `entries`, with each forbidden edge `file: specifier`. */
function closure(entries: string[], compiler: ts.CompilerOptions, forbid: (specifier: string, target: string | undefined) => boolean) {
  const seen = new Set<string>(), offenders: string[] = [];
  const walk = (file: string) => {
    file = slash(ts.sys.realpath?.(file) ?? file);
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const specifier of runtimeImports(source)) {
      const target = ts.resolveModuleName(specifier, file, compiler, ts.sys).resolvedModule?.resolvedFileName;
      const resolved = target && slash(target);
      if (forbid(specifier, resolved)) offenders.push(`${slash(file).slice(root.length + 1)}: ${specifier}`);
      else if (resolved && !resolved.includes("/node_modules/") && !/\.d\.[cm]?ts$/.test(resolved) && !resolved.endsWith(".json")) walk(resolved);
    }
  };
  for (const entry of entries) walk(entry);
  return { seen, offenders };
}

/** A route directory holds a `route.ts`; `route/host.ts` and `scene/host.ts` are kernel browser modules, not reads. */
const routeDirectories = () =>
  readdirSync(join(root, "apps/web/src"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "apps/web/src", entry.name, "route.ts")))
    .map((entry) => entry.name);
const routeHostReads = () =>
  routeDirectories()
    .filter((folder) => existsSync(join(root, "apps/web/src", folder, "host.ts")))
    .map((folder) => slash(join(root, "apps/web/src", folder, "host.ts")));

test("the host build reaches every route directory's host.ts and no browser-only module", { timeout: 120_000 }, () => {
  const { seen, offenders } = closure([join(root, "apps/host/src/index.ts")], options("apps/host"), (specifier, target) =>
    /^(?:react(?:-dom)?(?:\/|$)|@tanstack\/react-|lucide-react)|\.(?:css|scss|less)$/.test(specifier) ||
    !!target?.endsWith("/apps/web/src/host/runtime.ts") || /\/apps\/web\/src\/[^/]+\/route\.tsx?$/.test(target ?? ""));
  const hostReads = routeHostReads();
  expect({
    browserEdges: offenders,
    routeHostReadsOutsideTheBuild: hostReads.filter((file) => !seen.has(file)).map((file) => file.slice(root.length + 1)),
    routeDirectoriesWithAHostRead: hostReads.length,
  }, "no route directory holds a host.ts yet: host reads still live under apps/host/src/reads").toEqual({
    browserEdges: [], routeHostReadsOutsideTheBuild: [], routeDirectoriesWithAHostRead: expect.any(Number),
  });
  expect(hostReads.length, "no route directory holds a host.ts: the host build registers no route-directory read").toBeGreaterThan(0);
});

test("the web build reaches builtins through route/registry.ts and no host module", { timeout: 120_000 }, () => {
  const registry = join(root, "apps/web/src/route/registry.ts");
  // router.tsx reaches the TanStack file routes (routes/$route.tsx, design-system_.*, api/*) through routeTree.gen.ts.
  const entries = [join(root, "apps/web/src/router.tsx"), join(root, "apps/web/src/routes/__root.tsx"), join(root, "apps/web/src/route/builtin-routes.tsx"), registry];
  const reads = new Set(routeHostReads());
  // Vite resolves a client build under the `browser` export condition (@pe/runtime/context's browser twin).
  const { seen, offenders } = closure(entries, { ...options("apps/web"), customConditions: ["browser"] }, (specifier, target) =>
    specifier.startsWith("node:") || (!!target && (target.includes("/apps/host/src/") || reads.has(target))));
  expect({
    hostEdges: offenders,
    webRegistry: existsSync(registry) && seen.has(slash(registry)) ? "present" : "absent: builtins reach the web through builtin-modules.generated.ts",
  }).toEqual({ hostEdges: [], webRegistry: "present" });
});
