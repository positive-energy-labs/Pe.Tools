import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export const root = resolve(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
export function files(dir: string): string[] {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? ["node_modules", "bin", "obj", ".git"].includes(e.name)
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
export function selectionSlots(source: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  walk(source, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isCallExpression(n.initializer))
      return;
    const call = n.initializer;
    if (!/^(?:React\.)?use(?:State|Ref)$/.test(call.expression.getText(source))) return;
    const name = ts.isArrayBindingPattern(n.name)
      ? n.name.elements[0]?.getText(source)
      : n.name.getText(source);
    // Only explicit selection names; excludes DOM refs and booleans such as selecting/open.
    if (
      !name ||
      !/^(?:selected(?:Ids?|Keys?|Rows?|Elements?|Threads?|Fans?)?|selection|picked(?:Ids?|Keys?)?|active(?:Id|Key))$/i.test(
        name,
      )
    )
      return;
    if (
      /^(?:boolean|HTML\w*Element)(?:\s*\|\s*null)?$/.test(
        call.typeArguments?.[0]?.getText(source) ?? "",
      )
    )
      return;
    if (["true", "false"].includes(call.arguments[0]?.getText(source) ?? "")) return;
    found.push(n);
  });
  return found;
}

// Detector limits: direct calls only (no alias/data-flow analysis); z.custom is conservatively
// counted throughout host/web/MCP/contracts because static syntax cannot establish trust.
// Selection scans route-owned TSX, explicit selected/selection/picked/activeId names only;
// renamed slots, nested memory objects, imported hooks and inferred DOM refs need review.
// Arrays cover field(schema.array()) and routeAddress(...).schema.extend, not arbitrary
// schema aliases. Reads-that-write include queryVerb patches and audited owners below;
// this is a migration census, not proof that all transitive read effects are pure.

/** Declaration LOC excludes imports, comments, blanks and function/arrow bodies, but counts
 * their signatures and object/array declarations in subject, fields, readings, verbs, panes,
 * and stages. Directory/fixtures are metadata. Physical lines with mixed content count once. */
export function declarationLines(source: ts.SourceFile): number[] {
  const excluded = new Set<number>();
  const behavior = new Set<number>();
  const nouns = new Set(["subjectField", "fields", "readings", "verbs", "panes", "stages"]);
  walk(source, (n) => {
    if (!ts.isObjectLiteralExpression(n) || !n.properties.some((p) => prop(p, "key")) || !n.properties.some((p) => prop(p, "readings")) || !n.properties.some((p) => prop(p, "panes"))) return;
    for (const property of n.properties)
      if (nouns.has(property.name?.getText(source) ?? ""))
        for (let i = source.getLineAndCharacterOfPosition(property.getStart(source)).line; i <= source.getLineAndCharacterOfPosition(property.end).line; i++) behavior.add(i);
  });
  const line = (p: number) => source.getLineAndCharacterOfPosition(p).line;
  walk(source, (n) => {
    // Directory metadata and fixture seeds do not declare route behavior (ADR 0027).
    if (ts.isPropertyAssignment(n) && ["directory", "seeds"].includes(n.name.getText(source)))
      for (let i = line(n.getStart(source)); i <= line(n.end); i++) excluded.add(i);
    if (ts.isImportDeclaration(n))
      for (let i = line(n.getStart(source)); i <= line(n.end); i++) excluded.add(i);
    if (
      (ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n)) &&
      n.body
    ) {
      // A graph factory's body is the manifest itself, not an implementation callback.
      let graphFactory = false;
      walk(n.body, (child) => {
        if (ts.isObjectLiteralExpression(child) && child.properties.some((p) => prop(p, "readings")) && child.properties.some((p) => prop(p, "panes"))) graphFactory = true;
      });
      if (!graphFactory)
        for (let i = line(n.body.getStart(source)) + 1; i < line(n.body.end); i++) excluded.add(i);
    }
  });
  const lines = new Set<number>();
  const tokens = (node: ts.Node) => {
    const children = node.getChildren(source);
    if (children.length) { children.forEach(tokens); return; }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) return;
    const l = line(node.getStart(source));
    if (!excluded.has(l) && (!behavior.size || behavior.has(l))) lines.add(l + 1);
  };
  tokens(source);
  return [...lines].sort((a, b) => a - b);
}
/** Inspect only the Page value's outer schema, not arrays nested in a named object. */
export function arraySchema(node: ts.Node | undefined): boolean {
  if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (method === "array") return true;
  return ["default", "optional", "nullable", "readonly", "catch", "prefault", "max", "min", "refine", "transform"].includes(method)
    && arraySchema(node.expression.expression);
}

export function census() {
  const result: Record<string, string[]> = Object.fromEntries(
    [
      "hostCalls",
      "customDecodes",
      "pickFalse",
      "requiredReview",
      "reactSelection",
      "readWrites",
      "graphDeclarations",
      "peaRows",
      "arrayFields",
      "unscopedGeometry",
    ].map((key) => [key, []]),
  );
  const production = files("ts").filter(
    (p) => /\.[cm]?tsx?$/.test(p) && !/(?:\.test\.|\/tests\/|\.generated\.)/.test(p),
  );
  for (const p of production) {
    const source = syntax(read(p), p);
    const web = p.startsWith("ts/apps/web/src/");
    const route =
      web && !/^ts\/apps\/web\/src\/(?:shell|host|navigation|scene|kit|workbench|routes)\//.test(p);
    const add = (key: string, n: ts.Node) =>
      result[key]!.push(
        `${p}:${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1}: ${n.getText(source).split("\n")[0]!.slice(0, 110)}`,
      );
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
          n.arguments.some((a) => /\bpatches\s*:/.test(a.getText(source)))
        )
          add("readWrites", n);
      }
      if (
        prop(n, "pick") &&
        (n as ts.PropertyAssignment).initializer.kind === ts.SyntaxKind.FalseKeyword
      )
        add("pickFalse", n);
      if (
        prop(n, "review") &&
        /^["']required["']$/.test((n as ts.PropertyAssignment).initializer.getText(source))
      )
        add("requiredReview", n);
      if (
        p.endsWith("/pea/capabilities.ts") &&
        ts.isObjectLiteralExpression(n) &&
        n.properties.some((a) => prop(a, "key"))
      )
        add("peaRows", n);
      // Page schemas authored via routeAddress(...).schema.extend and field(...) declarations.
      if (
        ts.isCallExpression(n) &&
        n.expression.getText(source) === "field" &&
        arraySchema(n.arguments[0]) &&
        !/\bmany\s*:\s*true/.test(n.parent.getText(source))
      )
        add("arrayFields", n);
      if (
        ts.isCallExpression(n) &&
        /routeAddress\([\s\S]*\.schema\.extend$/.test(n.expression.getText(source))
      ) {
        const obj = n.arguments[0];
        if (obj && ts.isObjectLiteralExpression(obj))
          for (const a of obj.properties)
            if (
              ts.isPropertyAssignment(a) &&
              arraySchema(a.initializer)
            )
              add("arrayFields", a);
      }
    });
    if (route && p.endsWith(".tsx"))
      for (const n of selectionSlots(source)) add("reactSelection", n);
    if (web && p.endsWith("/graph.ts"))
      for (const l of declarationLines(source)) result.graphDeclarations!.push(`${p}:${l}`);
    if (p.startsWith("ts/apps/host/src/")) {
      // Conservative source-call census of the audited read owners, not a general call graph.
      const patterns: Record<string, RegExp> = {
        "ducts-sheet.ts": /\bwork\.workspace\.apply\s*\(/g,
        "schedule-actions.ts": /\b(?:work\.publish|captures\.saveSchedule)\s*\(/g,
        "pod-routes.ts": /\blifecycle\.refresh\s*\(/g,
        "plugins-handler.ts": /\bcontent\.lifecycle\.refresh\s*\(/g,
      };
      const pattern = patterns[p.split("/").at(-1)!];
      if (pattern)
        for (const m of source.text.matchAll(pattern)) {
          // schedule.bind now publishes through an explicit ActionJournal command.
          if (
            p.endsWith("schedule-actions.ts") &&
            m.index! > source.text.indexOf("export function scheduleExecutors")
          )
            continue;
          // The GET branch returns before the explicit plugin update reconciles lifecycle.
          if (
            p.endsWith("plugins-handler.ts") &&
            source.text.slice(0, m.index).includes('if (request.method === "GET") return')
          )
            continue;
          result.readWrites!.push(
            `${p}:${source.getLineAndCharacterOfPosition(m.index!).line + 1}: ${m[0]}`,
          );
        }
    }
  }
  // Read current Op axes; absent declarations fail closed.
  for (const p of files("dotnet").filter((p) => p.endsWith(".cs") && !p.includes("Tests/"))) {
    const text = read(p);
    for (const m of text.matchAll(/\[Op\(\s*"([^"]+)"((?:"(?:\\.|[^"\\])*"|[^"])*?)\)\]/gs)) {
      const axes = m[2]!.match(/^\s*,\s*OpSubject\.(\w+)\s*,\s*(OpTouches\.\w+(?:\s*\|\s*OpTouches\.\w+)*)\s*,\s*OpEffect\.(\w+)/);
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
        result.unscopedGeometry!.push(
          `${p}:${text.slice(0, m.index).split("\n").length}: ${m[1]} (${touches ?? "unclassified"}/${subject ?? "unclassified"})`,
        );
    }
  }
  return result;
}
