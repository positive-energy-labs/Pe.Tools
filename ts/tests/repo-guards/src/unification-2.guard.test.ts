import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import {
  additions,
  baselineFloors,
  boundaryCensus,
  census,
  identity,
  walk,
  root,
  syntax,
} from "./unification-2-census.ts";
import baseline from "./unification-2.baseline.json" with { type: "json" };
import "./unification-pane-bodies.law.ts";

const { legacyBuiltinRoutes, ...offenderBaseline } = baseline;

describe("unification 2 offender identities", () => {
  it("rejects added identities against baseline and committed floors", () => {
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
  }, 60000);
  it("cannot trade removed debt for a different offender or revive a zero", () => {
    expect(additions({ rule: ["b.ts#new"] }, { rule: ["a.ts#old"] })).toEqual(["rule: b.ts#new"]);
    expect(additions({ rule: ["b.ts#new"] }, { rule: [] })).toHaveLength(1);
    expect(additions({ rule: [] }, { rule: ["a.ts#old"] })).toEqual([]);
  });
  it("removing an earlier identical call preserves identities and duplicate caps", () => {
    const calls = (text: string) => {
      const sites: string[] = [];
      walk(syntax(text, "a.ts"), (node) => {
        if (ts.isCallExpression(node)) sites.push(identity(node));
      });
      return { rule: sites };
    };
    const two = calls("function owner() { fetch('a'); fetch('b'); }");
    const one = calls("function owner() { fetch('b'); }");
    expect(new Set(two.rule).size).toBe(1);
    expect(two.rule).toHaveLength(2);
    expect(additions(one, two)).toEqual([]);
    expect(additions(two, one)).toEqual([`rule: ${one.rule[0]}`]);
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
