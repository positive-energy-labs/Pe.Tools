import { expect, test } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { price, rememberPrice } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import { healPlan } from "@pe/ducts-domain/heal";
import { systemsNeedingFix } from "./system-list-search";
import { systemList } from "./system-list";
import { inferJoints } from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { SCENE_FIXTURE } from "./scene.fixture";
import { pricingClient, type PricingPort } from "./pricing-client";
import {
  pricingJob,
  type PricingInput,
  type PricingRequest,
  type PricingResponse,
} from "./pricing-job";
import { applyPricingDelta, pricingDelta } from "./pricing-delta";

const input = (revision = 1): PricingInput => ({
  snapshot: SCENE_FIXTURE.snapshot,
  grids: {},
  catalogs: EMPTY_CATALOGS,
  doc: ductsRouteState.schema.parse({}),
  revision,
  epoch: 0,
  documentKey: "s/d",
});
function port() {
  const requests: PricingRequest[] = [];
  let terminated = false;
  const worker: PricingPort = {
    postMessage: (request) => {
      requests.push(structuredClone(request));
    },
    terminate: () => {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return {
    worker,
    requests,
    stopped: () => terminated,
    respond: (response: PricingResponse) =>
      worker.onmessage!({ data: response } as MessageEvent<PricingResponse>),
  };
}

test("worker result has full solve/readiness parity through structured clone, including nested Maps", () => {
  const original = input();
  const run = pricingJob();
  let previous: unknown;
  let decoded: unknown;
  for (const [id, doc] of [
    original.doc,
    ductsRouteState.schema.parse({
      equipmentFlows: { "14107111": { staged: { value: { cfm: 176 } } } },
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
      needsFix: systemsNeedingFix(expected, doc, heal),
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

test("unit-flow edits reuse topology; staged verdicts invalidate it", () => {
  const snapshot = SCENE_FIXTURE.snapshot;
  const before = ductsRouteState.schema.parse({});
  const after = ductsRouteState.schema.parse({
    equipmentFlows: { "14107111": { staged: { value: { cfm: 176 } } } },
  });
  const inference = inferJoints(snapshot, 1, before);
  const heal = healPlan(snapshot, before);
  expect(inferJoints(snapshot, 1, after)).toBe(inference);
  expect(healPlan(snapshot, after)).toBe(heal);
  const ruled = ductsRouteState.schema.parse({
    assumptions: {
      "proximity:1:0|2:0": { staged: { value: { kind: "verdict", verdict: "ignore" } } },
    },
  });
  expect(inferJoints(snapshot, 1, ruled)).not.toBe(inference);
  expect(healPlan(snapshot, ruled)).not.toBe(heal);
});

test("obsolete deltas advance the private base without publishing stale Work", () => {
  const fake = port();
  const published: PricingResponse[] = [];
  const client = pricingClient(fake.worker, (_input, response) => published.push(response));
  const first = input();
  client.update(first);
  client.update({ ...first, revision: 2 });
  fake.respond({ id: 1, delta: { kind: "replace", value: { stable: 7, value: 1 } } });
  expect(published).toEqual([]);
  fake.respond({
    id: 2,
    delta: { kind: "object", edits: [["value", { kind: "replace", value: 2 }]], removed: [] },
  });
  expect(published).toEqual([{ id: 2, result: { stable: 7, value: 2 } }]);
  client.stop();
});

test("rapid Work edits coalesce; obsolete and out-of-order responses never publish; base is reused", () => {
  const fake = port();
  const published: number[] = [];
  const client = pricingClient(fake.worker, (input) => published.push(input.revision!));
  const first = input();
  client.update(first);
  client.update({ ...first, revision: 2 });
  client.update({ ...first, revision: 3 });
  expect(fake.requests).toHaveLength(1);
  fake.respond({ id: 99, error: "wrong id" });
  expect(fake.requests).toHaveLength(1);
  fake.respond({ id: 1, error: "obsolete" });
  expect(published).toEqual([]);
  expect(fake.requests).toHaveLength(2);
  expect(fake.requests[1]).not.toHaveProperty("base");
  fake.respond({ id: 1, error: "duplicate" });
  fake.respond({ id: 2, error: "current" });
  expect(published).toEqual([3]);
  client.stop();
  expect(fake.stopped()).toBe(true);
  fake.respond({ id: 2, error: "after stop" });
  expect(published).toEqual([3]);
});

test("document/snapshot/catalog changes resend the base and fence a running old result", () => {
  const fake = port();
  const published: PricingInput[] = [];
  const client = pricingClient(fake.worker, (input) => published.push(input));
  const first = input();
  client.update(first);
  client.update(null);
  fake.respond({ id: 1, error: "no longer displayed" });
  expect(published).toEqual([]);
  const next = {
    ...first,
    snapshot: structuredClone(first.snapshot),
    catalogs: {},
    documentKey: "s/other",
  };
  client.update(next);
  expect(fake.requests[1]).toHaveProperty("base");
  fake.respond({ id: 2, error: "current" });
  expect(published).toEqual([next]);
  client.stop();
});

test("worker errors are explicit and terminate the failed worker", () => {
  const fake = port();
  const errors: PricingResponse[] = [];
  const client = pricingClient(fake.worker, (_input, response) => errors.push(response));
  client.update(input());
  fake.worker.onerror!({ message: "worker failed" } as ErrorEvent);
  expect(errors).toEqual([{ id: 1, error: "worker failed" }]);
  expect(fake.stopped()).toBe(true);
  expect(pricingJob()({ id: 1, doc: null })).toEqual({
    id: 1,
    error: "Pricing has no snapshot or tables",
  });
});
