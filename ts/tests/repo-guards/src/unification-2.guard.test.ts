import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import {
  additions,
  baselineFloors,
  boundaryCensus,
  carry,
  floorAdditions,
  census,
  geometryCensus,
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
        floorAdditions(
          Object.fromEntries(Object.entries(offenderBaseline).filter(([rule]) => rule in floor.sites)),
          floor,
        ),
      ).toEqual([]);
  }, 120000);
  it("a moved file carries its allowance through the floors, and a planted allowance is still red", () => {
    const old = "ts/a/bay.tsx#Body:BindingElement", moved = "ts/b/bay.tsx#Body:BindingElement";
    const floor = carry({ fixtureMode: [old, "ts/a/other.tsx#X:BindingElement"] }, [{ "ts/a/bay.tsx": "ts/b/bay.tsx" }]);
    expect(floor.carried).toEqual({ [old]: moved });
    expect(floorAdditions({ fixtureMode: [moved] }, floor)).toEqual([]);
    // A stale old-name allowance still matches, but one floor entry never covers both names.
    expect(floorAdditions({ fixtureMode: [old] }, floor)).toEqual([]);
    expect(floorAdditions({ fixtureMode: [old, moved] }, floor)).toEqual([`fixtureMode: ${moved}`]);
    expect(floorAdditions({ fixtureMode: [moved, moved] }, floor)).toEqual([`fixtureMode: ${moved}`]);
    expect(floorAdditions({ fixtureMode: ["ts/b/bay.tsx#New:BindingElement"] }, floor)).toEqual(["fixtureMode: ts/b/bay.tsx#New:BindingElement"]);
    // Without the move the new path is a new identity; a path that still exists carries nothing.
    expect(floorAdditions({ fixtureMode: [moved] }, carry(floor.sites, []))).toHaveLength(1);
    expect(carry(floor.sites, [{ "ts/a/bay.tsx": "ts/b/bay.tsx" }], () => true).carried).toEqual({});
    expect(carry(floor.sites, [{ "ts/a/bay.tsx": "ts/b/bay.tsx" }, { "ts/b/bay.tsx": "ts/c/bay.tsx" }]).carried[old])
      .toBe("ts/c/bay.tsx#Body:BindingElement");
  });
  it("a geometry read names its subject, read from the catalog whatever the [Op] argument list says", () => {
    const row = (key: string, subject: string, touches: string, effect: string) => ({ key, subject, touches, effect });
    const catalog = [
      row("a.scoped", "Element", "Metadata, Geometry", "Read"),
      row("a.unscoped", "Document", "Metadata, Geometry", "TransactRead"),
      row("a.meta", "None", "Metadata", "Read"),
      row("a.write", "None", "Geometry", "ModelWrite"),
      row("a.orphan", "Element", "Geometry", "Read"),
    ];
    // The slice 3 shape: no positional effect. The census still reads the effect from the catalog.
    const source = `[Op("a.scoped", OpSubject.Element, OpTouches.Geometry)] [Op("a.unscoped")] [Op("a.meta")]
      [Op("a.write", OpSubject.None, OpTouches.Geometry, OpEffect.ModelWrite)] [Op("a.undeclared-in-catalog")]`;
    expect(geometryCensus(catalog, { "X.cs": source })).toEqual([
      "X.cs#Op:a.undeclared-in-catalog",
      "X.cs#Op:a.unscoped",
      "ts/packages/host-contracts/src/generated/host-catalog.generated.ts#Op:a.orphan",
    ]);
  });
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
