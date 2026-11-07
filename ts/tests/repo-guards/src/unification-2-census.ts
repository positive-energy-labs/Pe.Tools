import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
export function files(dir: string): string[] {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? ["node_modules", "bin", "obj", ".git", "dist", "dist-installed"].includes(e.name)
        ? []
        : files(`${dir}/${e.name}`)
      : [`${dir}/${e.name}`],
  );
}
export function syntax(text: string, file = "probe.tsx") {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}
export function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
const prop = (n: ts.Node, name: string) =>
  ts.isPropertyAssignment(n) && n.name.getText().replaceAll(/["']/g, "") === name;
function scope(node: ts.Node): string {
  const parts: string[] = [];
  for (
    let current: ts.Node | undefined = node;
    current && !ts.isSourceFile(current);
    current = current.parent
  )
    if (
      ts.isVariableDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isPropertyAssignment(current) ||
      ts.isMethodDeclaration(current)
    )
      parts.unshift(current.name?.getText() ?? "anonymous");
  return parts.join("/");
}
/** Semantic ancestry and syntax identify a bucket; repeated sites retain multiplicity. */
export function identity(node: ts.Node): string {
  const owner = scope(node);
  const text = ts.isCallExpression(node)
    ? node.expression.getText()
    : ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.getText().replaceAll(/\s+/g, " ")
      : ts.SyntaxKind[node.kind];
  return `${node.getSourceFile().fileName}#${owner}:${text}`;
}

const moduleCache = ts.createModuleResolutionCache(root, (path) => path, {});
export function resolveModule(file: string, specifier: string): string | undefined {
  const found = ts.resolveModuleName(
    specifier,
    resolve(root, file),
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      paths: {
        "#/*": [resolve(root, "ts/apps/web/src/*")],
        "@/*": [resolve(root, "ts/apps/web/src/*")],
      },
    },
    ts.sys,
    moduleCache,
  ).resolvedModule;
  return found ? relative(root, found.resolvedFileName).replaceAll("\\", "/") : undefined;
}

// Field cardinality belongs to route-field.ts types, not a second compiler/schema interpreter.
function structuralCensus() {
  const result: Record<string, string[]> = Object.fromEntries(
    ["hostCalls", "customDecodes", "readWrites", "peaRows", "unscopedGeometry"].map((key) => [
      key,
      [],
    ]),
  );
  const production = files("ts").filter(
    (p) => /\.[cm]?tsx?$/.test(p) && !/(?:\.test\.|\/tests\/|\.generated\.)/.test(p),
  );
  for (const p of production) {
    const source = syntax(read(p), p);
    const site = (node: ts.Node) =>
      identity(node)
        .replaceAll(root.replaceAll("\\", "/") + "/", "")
        .replaceAll(root + "\\", "");
    const web = p.startsWith("ts/apps/web/src/");
    const route =
      web && !/^ts\/apps\/web\/src\/(?:shell|host|navigation|scene|kit|workbench|routes)\//.test(p);
    const add = (key: string, n: ts.Node) => result[key]!.push(site(n));
    walk(source, (n) => {
      if (ts.isCallExpression(n)) {
        const name = n.expression.getText(source);
        if (
          web &&
          !p.includes("/shell/") &&
          (p.endsWith("/sources.ts") || route || p.includes("/routes/")) &&
          /^(?:requestJson|createPeClient|fetch|hostFetch|\w+\.requestJson)$/.test(name)
        )
          add("hostCalls", n);
        if (
          /^z\.custom$/.test(name) &&
          /(?:apps\/host|apps\/web|packages\/mcps|packages\/host-contracts)/.test(p)
        )
          add("customDecodes", n);
        if (
          name === "queryVerb" &&
          n.arguments.some(
            (a) => ts.isObjectLiteralExpression(a) && a.properties.some((p) => prop(p, "patches")),
          )
        )
          add("readWrites", n);
      }
      if (
        p.endsWith("/pea/capabilities.ts") &&
        ts.isObjectLiteralExpression(n) &&
        n.properties.some((a) => prop(a, "key"))
      )
        add("peaRows", n);
    });
    if (p.startsWith("ts/apps/host/src/")) {
      // Conservative source-call census of the audited read owners, not a general call graph.
      const owners: Record<string, string[]> = {
        "ducts-sheet.ts": ["work.workspace.apply"],
        "schedule-actions.ts": ["work.publish", "captures.saveSchedule"],
        "pod-routes.ts": ["lifecycle.refresh"],
        "plugins-handler.ts": ["content.lifecycle.refresh"],
      };
      walk(source, (n) => {
        if (
          !ts.isCallExpression(n) ||
          !owners[p.split("/").at(-1)!]?.includes(n.expression.getText())
        )
          return;
        let owner: ts.Node | undefined = n.parent;
        while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
        if (owner && ts.isFunctionDeclaration(owner) && owner.name?.text === "scheduleExecutors")
          return;
        // Plugin mutation is the explicit update command, not the GET read.
        if (p.endsWith("plugins-handler.ts")) return;
        add("readWrites", n);
      });
    }
  }

  return Object.fromEntries(Object.entries(result).map(([law, sites]) => [law, [...sites].sort()]));
}

function geometryCensus(): string[] {
  const result: string[] = [];
  // Read current Op axes; absent declarations fail closed.
  for (const p of files("dotnet").filter((p) => p.endsWith(".cs") && !p.includes("Tests/"))) {
    const text = read(p);
    for (const m of text.matchAll(/\[Op\(\s*"([^"]+)"((?:"(?:\\.|[^"\\])*"|[^"])*?)\)\]/gs)) {
      const axes = m[2]!.match(
        /^\s*,\s*OpSubject\.(\w+)\s*,\s*(OpTouches\.\w+(?:\s*\|\s*OpTouches\.\w+)*)\s*,\s*OpEffect\.(\w+)/,
      );
      const subject = axes?.[1];
      const touches = axes?.[2];
      const effect = axes?.[3];
      if (
        !effect ||
        !subject ||
        !touches ||
        ((effect === "Read" || effect === "TransactRead") &&
          touches.includes("Geometry") &&
          ["Document", "None"].includes(subject))
      )
        result.push(`${p}#Op:${m[1]}`);
    }
  }
  return [...new Set(result)].sort();
}

export function census(): Record<string, string[]> {
  let shared: Record<string, string[]> | undefined;
  const result: Record<string, string[]> = {};
  for (const law of ["hostCalls", "customDecodes", "readWrites", "peaRows"])
    Object.defineProperty(result, law, {
      enumerable: true,
      get: () => (shared ??= structuralCensus())[law],
    });
  Object.defineProperty(result, "unscopedGeometry", { enumerable: true, get: geometryCensus });
  return result;
}

export type OffenderSets = Record<string, string[]>;
export const baselinePath = "ts/tests/repo-guards/src/unification-2.baseline.json";
export function additions(actual: OffenderSets, allowed: OffenderSets): string[] {
  return Object.entries(actual).flatMap(([law, sites]) => {
    const remaining = new Map<string, number>();
    for (const site of allowed[law] ?? []) remaining.set(site, (remaining.get(site) ?? 0) + 1);
    return sites.flatMap((site) => {
      const count = remaining.get(site) ?? 0;
      if (count === 0) return [`${law}: ${site}`];
      remaining.set(site, count - 1);
      return [];
    });
  });
}

/** Read-only history check. Legacy numeric baselines cannot bless a new identity. The first
 * ordinal-free multiset baseline is the RATCHET-GREEN migration floor; every later snapshot constrains it. */
export function baselineFloors(): OffenderSets[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const mergeBase = git("merge-base", "HEAD", "origin/main");
  const commits = new Set([
    mergeBase,
    ...git("log", "--format=%H", "--", baselinePath).split(/\s+/).filter(Boolean),
  ]);
  return [...commits].flatMap((sha) => {
    if (!git("ls-tree", sha, "--", baselinePath)) return []; // This law did not exist at that merge base.
    const value: unknown = JSON.parse(git("show", `${sha}:${baselinePath}`));
    if (typeof value !== "object" || value === null || !Object.values(value).every(Array.isArray))
      return [];
    // RATCHET-GREEN explicitly re-baselines the legacy ordinal format with audited causes.
    // Incomparable old snapshots cannot cap the new buckets; later multiset floors still shrink.
    if (Object.values(value).some((sites) => sites.some((site: string) => /@\d+$/.test(site))))
      return [];
    return [value as OffenderSets];
  });
}

/** Explicit developer action; guards never invoke this. Removes allowances, never adds them.
 * Run from ts: node tests/repo-guards/src/unification-2-census.ts --tighten */

const WEB = "ts/apps/web/src/";
const privateModules = new Set([
  `${WEB}shell/page.ts`,
  `${WEB}shell/owner.ts`,
  `${WEB}route/view-owner.ts`,
]);
const compositionRoots = new Set([
  // Native typed mounts own the same fixture/live boundary as the admitted composition.
  `${WEB}shell/typed-mount.ts`,
  `${WEB}shell/typed-shell.tsx`,
  `${WEB}shell/mount-work.tsx`,
  `${WEB}shell/fixture-lane.ts`,
  // The shared selector was extracted without the retired fixture engine.
  `${WEB}shell/fixture-name.ts`,
  `${WEB}chat/owner.tsx`,
  `${WEB}shell/admitted-scope.ts`,
  `${WEB}shell/admitted-body.ts`,
  `${WEB}shell/admitted-readings.ts`,
]);
// Admitted Place composition may bind app capabilities and fixture inputs. Its implementation
// is private like the shell; direct private-owner imports and re-exports still cross the fence.
const admittedPlaceRoots = new Set([`${WEB}chat/owner.tsx`, `${WEB}workbench/provider/view.tsx`, `${WEB}workbench/thread-view.tsx`, `${WEB}route/builtin-routes.tsx`, `${WEB}pods/route.tsx`, `${WEB}router.tsx`]);
/** A declared pane may display its public provenance; this grants no legacy-owner access. */
function paneFixture(source: ts.SourceFile, node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const imports = new Set<string>();
  const aliases = new Map<string, ts.TypeNode>();
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement.type);
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text;
    if (module !== "@pe/agent-contracts" && !/\/route-kernel-bodies(?:\.ts)?$/.test(module)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const name of bindings.elements)
        if ((name.propertyName ?? name.name).text === "PaneContext") imports.add(name.name.text);
  }
  const pane = (type: ts.TypeNode | undefined, seen = new Set<string>()): boolean => {
    if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return false;
    const name = type.typeName.text;
    if (imports.has(name)) return true;
    if (name === "Pick" && type.typeArguments?.[1]?.getText(source) === '"fixture"') return pane(type.typeArguments[0], seen);
    if (seen.has(name)) return false;
    seen.add(name);
    return pane(aliases.get(name), seen);
  };
  for (let parent = node.parent; parent; parent = parent.parent)
    if (ts.isFunctionLike(parent)) {
      const parameter = parent.parameters.find((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.expression.getText(source));
      if (parameter) return pane(parameter.type);
    }
  return false;
}
/** Temporary legacy inventory. Source exports follow the same graph.ts convention as
 * codegen:routes; executable declarations, mount calls and registrations share one ratchet. */
export function legacyInventory(input?: Record<string, string>) {
  const sources = new Map(
    Object.entries(
      input ??
        Object.fromEntries(
          files("ts/apps/web/src")
            .filter((p) => /\.tsx?$/.test(p) && !/(?:\.test\.|\.gen\.)/.test(p))
            .map((p) => [p, read(p)]),
        ),
    ).map(([p, text]) => [p, syntax(text, p)]),
  );
  const doors = new Map([
    [`${WEB}shell/mount.tsx#mountRoute`, "legacyMounts"],
    [`${WEB}shell/mount.tsx#routeFromGraph`, "legacyRouterMounts"],
    [`${WEB}shell/legacy-route-door.ts#registerLegacyGraph`, "legacyRegistrations"],
    [`${WEB}shell/legacy-route-door.ts#registerLegacyModule`, "legacyPodLoaders"],
    [`${WEB}shell/legacy-route-door.ts#registerLegacyRegistration`, "legacyRegistrations"],
    [`${WEB}route/pod-view.tsx#makePodRoute`, "legacyPodLoaders"],
  ]);
  const bindings = new Map<string, Map<string, string>>();
  const aliases = new Map<string, Map<string, ts.Expression>>();
  const graphs: { file: string; symbol: string }[] = [];
  const sites: OffenderSets = Object.fromEntries(
    [...new Set([...doors.values(), "legacyGraphs"])].map((rule) => [rule, []]),
  );
  for (const [file, source] of sources) {
    const names = new Map<string, string>();
    bindings.set(file, names);
    const locals = new Map<string, ts.Expression>();
    aliases.set(file, locals);
    walk(source, (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name))
        locals.set(node.name.text, node.initializer);
    });
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        const target =
          [...sources.keys()].find((p) => p === specifier) ?? resolveModule(file, specifier);
        const named = statement.importClause?.namedBindings;
        if (target && named) {
          if (ts.isNamedImports(named))
            for (const element of named.elements)
              names.set(
                element.name.text,
                `${target}#${(element.propertyName ?? element.name).text}`,
              );
          else names.set(named.name.text, `${target}#*`);
        }
      }
      // Exported *Graph declarations are the canonical builtin module inventory used by codegen.
      // Admitted JSON re-exports have no executable declaration and leave this list on migration.
      if (
        file.endsWith("/graph.ts") &&
        ts.canHaveModifiers(statement) &&
        ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const declarations = ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : ts.isFunctionDeclaration(statement)
            ? [statement]
            : [];
        for (const declaration of declarations)
          if (declaration.name && declaration.name.getText().endsWith("Graph")) {
            const symbol = declaration.name.getText();
            graphs.push({ file, symbol });
            sites.legacyGraphs!.push(`${file}#${symbol}`);
          }
      }
    }
  }
  function resolved(file: string, expression: ts.Expression, seen = new Set<string>()): string {
    const text = expression.getText();
    const key = `${file}#${text}`;
    if (seen.has(key)) return key;
    seen.add(key);
    const names = bindings.get(file)!;
    const imported = names.get(text);
    if (imported) return imported;
    if (ts.isPropertyAccessExpression(expression)) {
      const namespace = names.get(expression.expression.getText());
      if (namespace?.endsWith("#*")) return namespace.slice(0, -1) + expression.name.text;
    }
    const alias = aliases.get(file)?.get(text);
    return alias && (ts.isIdentifier(alias) || ts.isPropertyAccessExpression(alias))
      ? resolved(file, alias, seen)
      : key;
  }
  for (const [file, source] of sources)
    walk(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const rule = doors.get(resolved(file, node.expression));
      if (rule) {
        const argument = node.arguments[0]?.getText() ?? "missing";
        const site = `${file}#${scope(node)}:${resolved(file, node.expression)}[${argument}]`;
        sites[rule]!.push(site);
      }
    });
  return {
    graphs: graphs.sort((a, b) => a.file.localeCompare(b.file)),
    sites: Object.fromEntries(Object.entries(sites).map(([rule, ids]) => [rule, [...ids].sort()])),
  };
}

export function boundaryCensus(input?: Record<string, string>): OffenderSets {
  const sources = new Map(
    Object.entries(
      input ??
        Object.fromEntries(
          files("ts")
            .filter(
              (p) =>
                /\.[cm]?[jt]sx?$/.test(p) &&
                !/(?:\.test\.|\/tests\/|\.generated\.|\/dist\/)/.test(p),
            )
            .map((p) => [p, read(p)]),
        ),
    ).map(([p, text]) => [p, syntax(text, p)]),
  );
  const result: OffenderSets = {
    ...legacyInventory(input).sites,
    rawPageImports: [],
    fixtureMode: [],
    uncheckedRegistry: [],
    malformedSources: [],
    dynamicModules: [],
  };
  const edges = new Map<string, { node: ts.Node; target: string }[]>();
  for (const [file, source] of sources) {
    const imports: { node: ts.Node; target: string }[] = [];
    edges.set(file, imports);
    // TypeScript recovers an AST from malformed input. Recovery must never mean clean.
    for (const diagnostic of (
      source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics)
      result.malformedSources!.push(`${file}#parse:${diagnostic.code}`);
    const admittedNames = new Set<string>();
    walk(source, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        ["@pe/agent-contracts", "@pe/agent-contracts/route-kernel-admission"].includes(
          node.moduleSpecifier.text,
        )
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements)
            if ((binding.propertyName ?? binding.name).text === "AdmittedRoute")
              admittedNames.add(binding.name.text);
      }
    });
    walk(source, (node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      )
        specifier = node.arguments[0];
      if (specifier) {
        if (ts.isStringLiteralLike(specifier)) {
          const name = specifier.text;
          const target =
            [...sources.keys()].find((p) => p === name || (name.startsWith("#/") && [".ts",".tsx"].some(ext=>p === `${WEB}${name.slice(2)}${ext}`))) ??
            resolveModule(file, name) ??
            (name.startsWith("#/") ? `${WEB}${name.slice(2)}.ts` : name);
          imports.push({ node, target });
        } else result.dynamicModules!.push(identity(node));
      }
      if (
        file.startsWith(WEB) &&
        !compositionRoots.has(file) &&
        !paneFixture(source, node) &&
        ((ts.isPropertyAccessExpression(node) && node.name.text === "fixture") ||
          (ts.isElementAccessExpression(node) &&
            node.argumentExpression &&
            ts.isStringLiteral(node.argumentExpression) &&
            node.argumentExpression.text === "fixture") ||
          (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText() === "fixture"))
      )
        result.fixtureMode!.push(identity(node));
      if (
        file.endsWith("route-registry.ts") &&
        (ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) &&
        node.name &&
        ["register", "registerGraph", "registerModule"].includes(node.name.getText())
      ) {
        const fn = ts.isMethodDeclaration(node)
          ? node
          : ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)
            ? node.initializer
            : undefined;
        const type = fn?.parameters[0]?.type;
        if (
          !type ||
          !ts.isTypeReferenceNode(type) ||
          !ts.isIdentifier(type.typeName) ||
          !admittedNames.has(type.typeName.text)
        )
          result.uncheckedRegistry!.push(identity(node.name));
      }
    });
  }
  // A type import may name a declaration beside its runtime without importing that runtime.
  // Direct private-owner type access remains forbidden, as does every executable/re-export path.
  const typeOnly=(node:ts.Node)=>
    (ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly ||
      (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
       node.importClause.namedBindings.elements.every(binding=>binding.isTypeOnly)))) ||
    (ts.isExportDeclaration(node) && node.isTypeOnly);
  function reaches(file: string, targets: Set<string>, seen = new Set<string>()): boolean {
    if (targets.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    // Kernel and admitted Place implementations may use private owners. Only re-exports cross
    // those composition facades; every other route/body wrapper remains fully traversed.
    return (edges.get(file) ?? []).some(
      (edge) =>
        !typeOnly(edge.node) &&
        ((!file.startsWith(WEB + "shell/") && !admittedPlaceRoots.has(file)) ||
          ts.isExportDeclaration(edge.node)) &&
        reaches(edge.target, targets, seen),
    );
  }
  for (const [file, imports] of edges) {
    const route =
      file.startsWith(WEB) &&
      !["shell/", "host/", "navigation/", "scene/", "kit/", "workbench/", "routes/"].some((dir) =>
        file.startsWith(WEB + dir),
      ) &&
      !privateModules.has(file);
    for (const edge of imports) {
      const compositionImport = admittedPlaceRoots.has(file) &&
        !privateModules.has(edge.target) && !ts.isExportDeclaration(edge.node);
      if (route && !compositionImport && (!typeOnly(edge.node) || privateModules.has(edge.target)) && reaches(edge.target, privateModules))
        result.rawPageImports!.push(identity(edge.node));
      if (
        file.startsWith(WEB) &&
        !compositionRoots.has(file) &&
        edge.target === `${WEB}shell/fixture-lane.ts`
      )
        result.fixtureMode!.push(identity(edge.node));
    }
  }
  return Object.fromEntries(Object.entries(result).map(([law, sites]) => [law, [...sites].sort()]));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename) &&
  process.argv.includes("--tighten")
) {
  const prior = JSON.parse(read(baselinePath)) as OffenderSets;
  const actual = { ...census(), ...boundaryCensus() };
  const next = Object.fromEntries(
    Object.entries(prior).map(([law, sites]) => [
      law,
      law === "legacyBuiltinRoutes" ? sites : sites.filter((site) => actual[law]?.includes(site)),
    ]),
  );
  writeFileSync(resolve(root, baselinePath), `${JSON.stringify(next, null, 2)}\n`);
}
