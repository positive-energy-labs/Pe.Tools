import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import {
  additions,
  arraySchema,
  baselineFloors,
  boundaryCensus,
  census,
  identity,
  root,
  syntax,
  zodArray,
} from "./unification-2-census.ts";
import baseline from "./unification-2.baseline.json" with { type: "json" };
import "./unification-pane-bodies.law.ts";

const { legacyBuiltinRoutes, ...offenderBaseline } = baseline;

export function trackedBytes() {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  return paths.map((path) => [
    path,
    createHash("sha256")
      .update(existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)) : "<deleted>")
      .digest("hex"),
  ]);
}

describe("unification 2 offender identities", () => {
  it("rejects added identities against baseline and committed floors without changing tracked bytes", () => {
    const before = trackedBytes();
    const actual = { ...census(), ...boundaryCensus() };
    expect(Object.keys(offenderBaseline).sort()).toEqual(Object.keys(actual).sort());
    expect(additions(actual, offenderBaseline)).toEqual([]);
    for (const floor of baselineFloors())
      expect(
        additions(
          Object.fromEntries(Object.entries(offenderBaseline).filter(([rule]) => rule in floor)),
          floor,
        ),
      ).toEqual([]);
    expect(trackedBytes()).toEqual(before);
  }, 60000);
  it("cannot trade removed debt for a different offender or revive a zero", () => {
    expect(additions({ rule: ["b.ts#new"] }, { rule: ["a.ts#old"] })).toEqual(["rule: b.ts#new"]);
    expect(additions({ rule: ["b.ts#new"] }, { rule: [] })).toHaveLength(1);
    expect(additions({ rule: [] }, { rule: ["a.ts#old"] })).toEqual([]);
  });
  it("identities survive blank lines and distinguish sites", () => {
    const sites = (text: string) => {
      const source = syntax(text, "a.ts");
      return source.statements
        .filter(ts.isVariableStatement)
        .map((n) => identity(n.declarationList.declarations[0]!));
    };
    expect(sites("const a = 1;\nconst b = 1;")).toEqual(sites("\nconst a = 1;\n\nconst b = 1;"));
    expect(new Set(sites("const a = 1; const b = 1;")).size).toBe(2);
  });
});

it("finds arrays structurally through wrappers, unions, aliases and tuples", () => {
  const contains = (text: string) => {
    const source = syntax(text);
    const last = source.statements.at(-1)!;
    return arraySchema(ts.isExpressionStatement(last) ? last.expression : last);
  };
  for (const text of [
    "z.array(z.string()).readonly().default([])",
    "z.object({ columns: z.array(z.string()) }).default({ columns: [] })",
    "z.union([z.string(), z.object({ x: z.array(z.string()) })])",
    "const nested = z.object({ x: z.string().array() }); field(nested)",
    "const a = z.tuple([z.string()]); const b = a.optional(); field(b)",
  ])
    expect(contains(text), text).toBe(true);
  expect(contains("z.object({ x: z.string() })")).toBe(false);
  expect(contains("sortField({})")).toBe(false);
  expect(contains("orderedListField(z.string(), { cap: 3 })")).toBe(false);
  expect(contains("field(z.array(z.string()), {})")).toBe(true);
});

it("resolved Zod AST follows an imported schema alias and factory despite a runtime mock", () => {
  const file = resolve(root, "ts/packages/agent-contracts/src/guard-probe.ts").replaceAll(
    "\\",
    "/",
  );
  const dependency = resolve(root, "ts/packages/agent-contracts/src/guard-schema.ts").replaceAll(
    "\\",
    "/",
  );
  const sources = new Map([
    [
      file,
      `import { schema as hidden } from './guard-schema'; declare const vi: { mock: Function }; vi.mock('./guard-schema', () => ({})); const wrapped = hidden;`,
    ],
    [
      dependency,
      `import { z } from 'zod'; const make = () => z.object({ inner: z.union([z.string(), z.object({ values: z.array(z.number()) })]) }); export const schema = make();`,
    ],
  ]);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (path) => sources.has(path) || fileExists(path);
  host.getSourceFile = (path, ...args) =>
    sources.has(path)
      ? ts.createSourceFile(path, sources.get(path)!, ts.ScriptTarget.Latest, true)
      : getSourceFile(path, ...args);
  const program = ts.createProgram([file, dependency], options, host);
  const source = program.getSourceFile(file)!;
  const declaration = (source.statements.at(-1) as ts.VariableStatement).declarationList
    .declarations[0]!;
  expect(arraySchema(declaration.initializer!, new Set(), program.getTypeChecker())).toBe(true);
  expect(
    zodArray(
      program.getTypeChecker().getTypeAtLocation(declaration.initializer!),
      program.getTypeChecker(),
    ),
  ).toBe(true);
}, 30000);

it("the private legacy route roster can only shrink", () => {
  const source = syntax(
    readFileSync(resolve(root, "ts/apps/web/src/shell/legacy-route-door.ts"), "utf8"),
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => declaration.name.getText(source) === "legacyBuiltinKeys");
  expect(declaration?.initializer && ts.isArrayLiteralExpression(declaration.initializer)).toBe(
    true,
  );
  if (!declaration?.initializer || !ts.isArrayLiteralExpression(declaration.initializer))
    throw Error("Missing literal legacy route roster");
  const keys = declaration.initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) throw Error("Legacy keys must be literal identities");
    return element.text;
  });
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.filter((key) => !legacyBuiltinRoutes.includes(key))).toEqual([]);
  for (const floor of baselineFloors()) {
    if (floor.legacyBuiltinRoutes)
      expect(
        legacyBuiltinRoutes.filter((key) => !floor.legacyBuiltinRoutes!.includes(key)),
      ).toEqual([]);
  }
});
