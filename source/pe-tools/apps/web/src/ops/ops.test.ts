import { expect, test } from "vite-plus/test";

import { prune, requestOf, seedValues, setPath } from "./form";
import { opNeeds, opsRefusal, type HostOperationCatalogEntry } from "./manifest";
import { runOp } from "./run";

const bridgeMutation = {
  key: "revit.apply.schedule",
  intent: "Mutate",
  needs: "document",
} as HostOperationCatalogEntry;
const bridgeRead = {
  key: "revit.detail.sheets",
  intent: "Read",
  needs: "document",
} as HostOperationCatalogEntry;
const hostMutation = {
  key: "host.shell.open",
  intent: "Mutate",
  needs: "nothing",
} as HostOperationCatalogEntry;

test("intent is judged before origin: a bridge mutation needs controlled custody, a host-local one has none to judge", () => {
  expect(opsRefusal(undefined)).toBe("pick an operation");
  expect(opsRefusal({ key: "x", needs: "nothing" } as HostOperationCatalogEntry)).toMatch(
    /metadata/,
  );
  expect(opsRefusal(bridgeMutation, "observed")).toMatch(/controlled/);
  expect(opsRefusal(bridgeMutation, undefined)).toMatch(/controlled/);
  expect(opsRefusal(bridgeMutation, "controlled")).toBeNull();
  expect(opsRefusal(bridgeRead, "observed")).toBeNull();
  expect(opsRefusal(hostMutation, undefined)).toBeNull();
});

test("the harness resolves the target: needs come from the op, host-local ops need only the host", () => {
  expect(opNeeds(undefined)).toBe("host");
  expect(opNeeds(hostMutation)).toBe("host");
  expect(opNeeds({ key: "revit.x", needs: "nothing" } as HostOperationCatalogEntry)).toBe(
    "session",
  );
  expect(opNeeds(bridgeMutation)).toBe("document");
  expect(opNeeds({ key: "revit.x", needs: "family-document" } as HostOperationCatalogEntry)).toBe(
    "family",
  );
});

test("form values round-trip: dotted paths write through arrays, empties are unset, raw JSON bypasses the schema", () => {
  expect(setPath({ a: { b: 1 } }, ["a", "c"], 2)).toEqual({ a: { b: 1, c: 2 } });
  expect(setPath({ rows: [{ n: 1 }] }, ["rows", "0", "n"], 5)).toEqual({ rows: [{ n: 5 }] });
  expect(prune({ a: "", b: null, c: { d: "", e: 0 }, f: [""] })).toEqual({
    c: { e: 0 },
    f: [undefined],
  });
  expect(requestOf({ $raw: " " })).toBeUndefined();
  expect(requestOf({ $raw: '{"k":1}' })).toEqual({ k: 1 });
  expect(
    seedValues('{"type":"object","properties":{"n":{"type":"integer","default":3}}}', '{"m":1}'),
  ).toEqual({
    m: 1,
    n: 3,
  });
});

test("a read takes the plain call lane and never touches the journal", async () => {
  const calls: unknown[] = [];
  const outcome = await runOp({
    op: bridgeRead,
    request: { sheet: "A1" },
    target: { kind: "document", ref: { session: "S", openId: "D" } },
    call: async (key, input) => {
      calls.push([key, input]);
      return { ok: true };
    },
    priorActionId: "unsettled-but-irrelevant-for-reads",
  });
  expect(outcome).toMatchObject({ kind: "value", value: { ok: true } });
  expect(calls).toEqual([["revit.detail.sheets", { sheet: "A1" }]]);
});
