import { expect, test } from "vite-plus/test";
import {
  address,
  bridgeSelector,
  resolveScope,
  scopeKey,
  scopeSchema,
  type FleetSession,
} from "../src/index.ts";

const projectA = address("C:\\Models\\projectA.rvt");
const tower = address("C:\\Models\\Tower.rvt");
const app25: FleetSession = { id: "pe.app-25", document: projectA };
const app26: FleetSession = { id: "pe.app-26", document: tower };
const idle: FleetSession = { id: "pe.idle", document: null };

test("a document scope follows the file: one holder resolves, none is unheld, two is ambiguous", () => {
  const scope = { kind: "document", document: projectA } as const;
  expect(resolveScope(scope, [app25, app26])).toEqual({
    kind: "resolved",
    session: "pe.app-25",
    document: projectA,
  });
  expect(resolveScope(scope, [app26, idle])).toEqual({
    kind: "unheld",
    document: projectA,
    sessions: ["pe.app-26", "pe.idle"],
  });
  // A central and a local: the normal Revit day, and the one case the user must decide.
  expect(resolveScope(scope, [app25, { id: "pe.app-27", document: projectA }])).toEqual({
    kind: "ambiguous",
    document: projectA,
    holders: ["pe.app-25", "pe.app-27"],
  });
});

test("a pinned scope is the user's decision: it never drifts to another holder", () => {
  const scope = { kind: "pinned", session: "pe.app-25", document: projectA } as const;
  expect(resolveScope(scope, [app25, { id: "pe.app-27", document: projectA }])).toMatchObject({
    kind: "resolved",
    session: "pe.app-25",
  });
  expect(resolveScope(scope, [app26])).toEqual({ kind: "gone", session: "pe.app-25" });
  // The pinned session is alive but moved on to another file: unheld, naming who holds it now.
  expect(
    resolveScope(scope, [
      { id: "pe.app-25", document: tower },
      { id: "x", document: projectA },
    ]),
  ).toEqual({ kind: "unheld", document: projectA, sessions: ["x"] });
});

test("a session scope names an idle Revit; none resolves only when the fleet has exactly one", () => {
  expect(resolveScope({ kind: "session", session: "pe.idle" }, [idle])).toEqual({
    kind: "resolved",
    session: "pe.idle",
    document: null,
  });
  expect(resolveScope({ kind: "session", session: "pe.idle" }, [])).toEqual({
    kind: "gone",
    session: "pe.idle",
  });
  expect(resolveScope({ kind: "none" }, [app25])).toMatchObject({ kind: "resolved" });
  expect(resolveScope({ kind: "none" }, [app25, app26])).toEqual({
    kind: "nothing",
    sessions: ["pe.app-25", "pe.app-26"],
  });
});

test("the wire refuses the old nullable shape and every variant has one key and one selector", () => {
  expect(scopeSchema.safeParse({ session: null, document: null }).success).toBe(false);
  expect(scopeSchema.safeParse({ kind: "document" }).success).toBe(false);
  expect(scopeSchema.safeParse({ kind: "pinned", session: "a", document: projectA }).success).toBe(
    true,
  );
  expect(scopeKey({ kind: "document", document: projectA })).toBe(`scope:|${projectA}`);
  expect(bridgeSelector({ kind: "document", document: projectA })).toBe(`doc:${projectA}`);
  expect(bridgeSelector({ kind: "pinned", session: "a", document: projectA })).toBe("session:a");
  expect(bridgeSelector({ kind: "none" })).toBeUndefined();
});
