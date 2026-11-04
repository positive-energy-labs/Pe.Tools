/**
 * FANSPLIT (kaitpw 2026-11-03, Q5): the ducts Work 1 -> 2 migration deletes the fan cells and the
 * Load Preview; every ducts-owned cell survives as saved. Real ducts builtin admission over saved
 * v1 envelopes at an address binding and an open binding.
 */
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { address, bindWork, ductsDocumentSchema, workKey } from "@pe/agent-contracts";
import { settle } from "./effect-test.ts";
import { AdmittedBuiltins, admittedBuiltinsLayer } from "../src/admitted-builtins.ts";

const rungs = <V>(value: V) => ({ suggestion: { value }, edit: { value } });
const kept = {
  criteria: rungs({ allowanceInWg: { return: 0.35 } }),
  kinds: { [JSON.stringify(["FCU", "A"])]: rungs({ kind: "fan-coil" }) },
  assumptions: { "open-end:g1:2:1": rungs({ kind: "verdict", verdict: "capped" }) },
  rules: { "elbow-round": rungs({ table: "CD3-9" }) },
  catalogs: { [JSON.stringify(["Grille", ""])]: rungs({ table: "titus-300" }) },
  ruleAssignments: { "Odd Elbow": rungs({ rule: "elbow-round" }) },
  subject: { g1: rungs([1, 2, 3]) },
  claims: { c1: rungs({ title: "Run", text: "One run.", ids: [1], state: "assumed" }) },
  labelParameter: rungs("PE_G___TagInstance"),
  workingPhase: rungs("New Construction"),
  systemColours: rungs({
    supply: "#0569a5",
    return: "#02bba4",
    exhaust: "#fea665",
    fresh: "#1cbcd5",
    unknown: "#808080",
  }),
};
const scope = { groups: ["g1"], fan: { unitId: 1, systemId: 9 } };
const dropped = {
  terminalDrops: { "2": rungs({ inWg: 0.1, source: "submittal" }) },
  componentDrops: { "3": rungs({ inWg: 0.02 }) },
  esp: { "1": rungs({ inWg: 0.5 }) },
  flows: { "2": rungs({ cfm: 100 }) },
  equipmentFlows: { "1": rungs({ cfm: 400 }) },
  roles: { "1": rungs({ role: "fan" }) },
  parameters: { fanFlow: rungs("PE_Flow") },
  calculation: { s: rungs({ kind: "balanced-design", source: "design" }) },
  designFriction: rungs(0.08),
  loads: { preview: rungs({ systems: [{ name: "System 1 FC-1", tag: "FC-1", cfm: 400, rooms: [] }] }) },
};
const v1 = {
  ...kept,
  ...dropped,
  writeIntent: rungs({
    ...scope,
    walk: { unitId: 1, portIndex: 0 },
    cells: [
      ["rules", "elbow-round"],
      ["equipmentFlows", "1"],
    ],
  }),
};
const keys = [
  workKey(bindWork("ducts", address("C:/Models/Split.rvt"))),
  workKey(bindWork("ducts", null, undefined, { session: "s1", openId: "o1" })),
];

function store() {
  const saved = new Map<string, unknown>(
    keys.map((targetKey) => [
      targetKey,
      { version: 1, schemaVersion: 1, revision: 4, doc: structuredClone(v1), history: [] },
    ]),
  );
  return {
    saved,
    getState: async ({ targetKey }: { targetKey: string }) => saved.get(targetKey),
    setState: async ({ targetKey, value }: { targetKey: string; value: unknown }) => {
      saved.set(targetKey, value);
    },
    listState: async () => ({
      records: [...saved].map(([targetKey, value]) => ({ targetKey, route: "ducts", value })),
      truncated: false,
      unreadable: 0,
      unindexed: 0,
    }),
  };
}
async function admit(s: ReturnType<typeof store>) {
  const ws = new RouteWorkspace({ registrations: [], store: s });
  await settle(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const built = yield* Layer.buildWithScope(admittedBuiltinsLayer(ws), scope);
      Context.get(built, AdmittedBuiltins);
      yield* Scope.close(scope, Exit.void);
    }),
  );
}

test("ducts Work 1 -> 2 keeps every ducts cell, drops the fan cells and Load Preview, and runs once", async () => {
  const s = store();
  await admit(s);
  for (const key of keys) {
    const record = s.saved.get(key) as { schemaVersion: number; revision: number; doc: Record<string, unknown>; history: unknown[] };
    expect(record).toMatchObject({ schemaVersion: 2, revision: 5, history: [] });
    const doc = ductsDocumentSchema.parse(record.doc);
    expect(Object.keys(record.doc).sort()).toEqual([...Object.keys(kept), "writeIntent"].sort());
    for (const [segment, cell] of Object.entries(kept))
      expect(JSON.stringify(record.doc[segment])).toBe(JSON.stringify(cell));
    expect(doc.writeIntent).toEqual(rungs({ ...scope, cells: [["rules", "elbow-round"]] }));
    for (const segment of Object.keys(dropped)) expect(record.doc).not.toHaveProperty(segment);
  }
  const once = JSON.stringify([...s.saved]);
  await admit(s);
  expect(JSON.stringify([...s.saved])).toBe(once);
});
