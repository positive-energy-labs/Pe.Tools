import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import {
  additions,
  baselineFloors,
  boundaryCensus,
  census,
  identity,
  walk,
  syntax,
} from "./unification-2-census.ts";
import baseline from "./unification-2.baseline.json" with { type: "json" };
import "./unification-pane-bodies.law.ts";

const offenderBaseline = baseline;

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
