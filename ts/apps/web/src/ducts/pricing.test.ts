import { expect, test } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { price, rememberPrice } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import { healPlan } from "@pe/ducts-domain/heal";
import { systemNotes } from "./system-list-search";
import { systemList } from "./system-list";
import { inferJoints } from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { SCENE_FIXTURE } from "./scene.fixture";
import { pricingJob, type PricingInput } from "./pricing-job";
import { applyPricingDelta, pricingDelta } from "./pricing-delta";
import { EMPTY_SNAPSHOT } from "./sheet/scoped-snapshot";
import { noTerminalSnapshot } from "./no-terminal.fixture";

const input = (): PricingInput => ({
  snapshot: SCENE_FIXTURE.snapshot,
  grids: {},
  catalogs: EMPTY_CATALOGS,
  doc: ductsRouteState.schema.parse({}),
});
test("a fan with no terminal fails pricing with its system and open outlet, rather than waiting", () => {
  const response = pricingJob()({
    id: 1,
    doc: null,
    base: { snapshot: noTerminalSnapshot(), grids: {}, catalogs: EMPTY_CATALOGS },
  });
  expect("error" in response && response.error).toBe(
    "EX 1 has no terminal: its air leaves at open end 11620957; nothing to price",
  );
});
test("worker result has full solve/readiness parity through structured clone, including nested Maps", () => {
  const original = input();
  const run = pricingJob();
  let previous: unknown;
  let decoded: unknown;
  for (const [id, doc] of [
    original.doc,
    ductsRouteState.schema.parse({
      equipmentFlows: { "14107111": { edit: { value: { cfm: 176 } } } },
    }),
    ductsRouteState.schema.parse({}),
  ].entries()) {
    const response = structuredClone(
      run(structuredClone({ id, doc, ...(id === 0 ? { base: original } : {}) })),
    );
    expect(response).not.toHaveProperty("error");
    if (!("result" in response)) throw Error("Missing worker result");
    const delta = structuredClone(pricingDelta(previous, response.result));
    decoded = delta ? applyPricingDelta(decoded, delta) : decoded;
    expect(decoded).toEqual(response.result);
    previous = response.result;
    const expected = price(original.snapshot, original.grids, doc, original.catalogs);
    expect(response.result.priced).toEqual(expected);
    expect(response.result.ready).toEqual(readiness(original.snapshot, doc));
    const heal = healPlan(original.snapshot, doc);
    expect(response.result.analysis).toEqual({
      heal,
      notes: systemNotes(expected, doc, heal),
      systems: systemList(expected.snapshot, expected),
      inference: inferJoints(original.snapshot, 1, withStoredRulings(doc, original.snapshot.store)),
    });
    expect(response.result.priced.flows).toBeInstanceOf(Map);
    expect(response.result.priced.fanFlows).toBeInstanceOf(Map);
    for (const flows of response.result.priced.fanFlows.values()) expect(flows).toBeInstanceOf(Map);
    rememberPrice(
      original.snapshot,
      original.grids,
      doc,
      original.catalogs,
      response.result.priced,
    );
    expect(price(original.snapshot, original.grids, doc, original.catalogs)).toBe(
      response.result.priced,
    );
  }
});

test("deltas preserve untouched identities, Map keys/deletions, arrays, and non-finite numbers", () => {
  const before = {
    stable: { value: 3 },
    map: new Map([
      [1, [NaN, Infinity]],
      [2, [2]],
    ]),
    rows: [1, 2],
    old: true,
  };
  const after = {
    stable: { value: 3 },
    map: new Map([
      [1, [NaN, Infinity]],
      [3, [4]],
    ]),
    rows: [1, 3],
  };
  const delta = structuredClone(pricingDelta(before, after)!);
  const restored = applyPricingDelta(before, delta) as typeof after;
  expect(restored).toEqual(after);
  expect(restored.stable).toBe(before.stable);
  expect(restored.map.get(1)).toBe(before.map.get(1));
  expect(before).toHaveProperty("old", true);
  expect(before.map.has(2)).toBe(true);
  const authoredKey = JSON.parse('{"__proto__":{"priced":7}}');
  const restoredKey = applyPricingDelta({}, pricingDelta({}, authoredKey)!);
  expect(restoredKey).toEqual(authoredKey);
  expect(Object.getPrototypeOf(restoredKey)).toBe(Object.prototype);
});

test("unit-flow edits reuse topology; edit verdicts invalidate it", () => {
  const snapshot = SCENE_FIXTURE.snapshot;
  const before = ductsRouteState.schema.parse({});
  const after = ductsRouteState.schema.parse({
    equipmentFlows: { "14107111": { edit: { value: { cfm: 176 } } } },
  });
  const inference = inferJoints(snapshot, 1, before);
  const heal = healPlan(snapshot, before);
  expect(inferJoints(snapshot, 1, after)).toBe(inference);
  expect(healPlan(snapshot, after)).toBe(heal);
  const ruled = ductsRouteState.schema.parse({
    assumptions: {
      "proximity:1:0|2:0": { edit: { value: { kind: "verdict", verdict: "ignore" } } },
    },
  });
  expect(inferJoints(snapshot, 1, ruled)).not.toBe(inference);
  expect(healPlan(snapshot, ruled)).not.toBe(heal);
});

test("a just-started-fresh Work (the schema's empty parse), no Work, and an empty snapshot all price", () => {
  const fresh = ductsRouteState.schema.parse({});
  for (const snapshot of [SCENE_FIXTURE.snapshot, EMPTY_SNAPSHOT])
    for (const doc of [fresh, null]) {
      const response = pricingJob()({
        id: 1,
        doc,
        base: { snapshot, grids: {}, catalogs: EMPTY_CATALOGS },
      });
      expect(response).not.toHaveProperty("error");
    }
});
