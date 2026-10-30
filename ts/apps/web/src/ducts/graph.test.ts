import { expect, test } from "vite-plus/test";
import {
  bindWork,
  ductsRouteState,
  projectRouteGraph,
  validateRouteGraph,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { pricingJob, type PricingResult } from "./pricing-job";
import { ductsGraph, ductsPageSchema, type DuctsPage } from "./graph";
import { ductsBinding } from "./actions";
import type { BindingScope } from "#/shell/mount-owner";
import type { ReadingState } from "#/shell/readings";
import { snapshot } from "./test-fixture";
import { noTerminalSnapshot } from "./no-terminal.fixture";
const state = (value: unknown): ReadingState => ({
  status: "ready",
  value,
  current: true,
  complete: true,
  version: 1,
  basis: {
    workRevision: 1,
    attempt: {
      target: { kind: "document", ref: { session: "s", openId: "d" } },
      workKey: { binding: "host", route: "ducts", target: null },
      generation: 1,
    },
    inputs: {},
  },
});
export function scopeFor(doc: DuctsRouteDocument): BindingScope<DuctsPage, DuctsRouteDocument> {
  const grids = {};
  const input = { snapshot, grids, catalogs: EMPTY_CATALOGS };
  const response = pricingJob()({ id: 1, base: input, doc });
  if (!("result" in response)) throw Error("Pricing failed");
  return {
    target: { kind: "document", ref: { session: "s", openId: "d" } },
    work: {
      handle: {
        key: bindWork("ducts", null, undefined, { session: "s", openId: "d" }),
        revision: 1,
      },
      doc,
    },
    page: ductsPageSchema.parse({ system: ["SA"] }) as DuctsPage,
    readings: {
      ducts: state(snapshot),
      tables: state(grids),
      catalogs: state({ tables: EMPTY_CATALOGS, findings: [] }),
      pricing: state(response.result as PricingResult),
    },
  };
}
test("Heal and Preview heal need a current network and Work, even when pricing failed", () => {
  const scope = scopeFor(ductsRouteState.schema.parse({}));
  scope.page = { ...scope.page, system: ["EX 1"] };
  const network = noTerminalSnapshot();
  network.segments[0]!.connectors[1]!.flowCfm = 0;
  scope.readings = {
    ducts: state(network),
    pricing: {
      ...state(undefined),
      status: "failed",
      current: false,
      error: "EX 1 has no terminal; nothing to price",
    },
  };
  for (const id of ["heal", "heal-preview"])
    expect(ductsBinding(id, { group: "g1" }, scope).args).toMatchObject({
      refusal: null,
      request: { groups: [{ group: "g1" }] },
    });
  expect(ductsBinding("price", undefined, scope).args).toMatchObject({
    refusal: "pricing failed: EX 1 has no terminal; nothing to price",
  });
});
test("the product graph keeps all ducts inputs in Work across fourteen cell families", () => {
  expect(ductsGraph.work).toBe(ductsRouteState.schema);
  expect(validateRouteGraph(ductsGraph)).toEqual([]);
  const graph = projectRouteGraph(ductsGraph);
  expect(graph.cells).toHaveLength(14);
  expect(graph.cells?.some((family) => family.segment === "parameters")).toBe(true);
  expect(graph.fields).not.toHaveProperty("terminalFlow");
  expect(graph.fields).not.toHaveProperty("fanStatic");
  expect(Object.values(graph.fields).some((field) => field.role === "setting")).toBe(false);
  expect(graph.stageOrder).toEqual(["network", "sheet"]);
  expect(graph.pick).toBe(false);
  expect(graph.verbs.price).toMatchObject({ does: "ducts.apply-losses", review: "shown" });
  expect(graph.verbs.heal).toMatchObject({ does: "ducts.apply-heal", review: "shown" });
  expect(graph.verbs["assign-fan"]).toMatchObject({
    does: "ducts.apply-assign-fan",
    review: "shown",
  });
  expect(Object.keys(graph.fields)).not.toEqual(
    expect.arrayContaining(["evaluation", "heal", "fan", "epoch"]),
  );
});
test("the price request is scoped and stable for one reading basis; standing Set rows hold only the ESP", () => {
  const scope = scopeFor(
    ductsRouteState.schema.parse({
      flows: { "4": { edit: { value: { cfm: 100, source: "override" } } } },
      esp: { "100": { edit: { value: { inWg: 0.5 } } } },
    }),
  );
  const first = ductsBinding("price", undefined, scope).args as {
    request: { equipment: unknown[]; terminalFlows: unknown[] };
    refusal: null;
  };
  expect(first.refusal).toBeNull();
  expect(first.request.equipment).toEqual([]);
  expect(first.request.terminalFlows).toContainEqual({ id: 4, cfm: 100, source: "override" });
  expect((ductsBinding("price", undefined, scope).args as { request: unknown }).request).toBe(
    first.request,
  );
  scope.work!.handle.revision = 2;
  expect(ductsBinding("price", undefined, scope).args).toMatchObject({
    refusal: expect.stringContaining("Pricing is refreshing"),
  });
});
test("native writes keep the observed Work slots even when historical Work has another slot", () => {
  const scope = scopeFor(
    ductsRouteState.schema.parse({
      parameters: { terminalFlow: { edit: { value: "Historical flow" } } },
      flows: { "4": { edit: { value: { cfm: 100, source: "override" } } } },
    }),
  );
  const observed = { ...snapshot, slots: { ...snapshot.slots, terminalFlow: "Observed flow" } };
  scope.readings = { ...scope.readings, ducts: state(observed) };
  expect(ductsBinding("price", undefined, scope).args).toMatchObject({
    refusal: null,
    request: { slots: { terminalFlow: "Observed flow" } },
  });
});

test("system changes retain a shared camera and selection, clear them for a different subject, and cap open order", () => {
  const current = {
    ...ductsPageSchema.parse({ system: ["SA"], selected: "4" }),
    viewport: { kind: "orbit", yaw: 20, elev: 30, zoom: 2, pivot: [0, 0, 0] },
  } as DuctsPage;
  expect(ductsGraph.transition!(current, { system: ["SA", "RA"] }, "page")).toMatchObject({
    patch: { system: ["SA", "RA"] },
  });
  expect(ductsGraph.transition!(current, { system: ["Other"] }, "page")).toMatchObject({
    patch: { selected: "", viewport: null, issue: "" },
  });
  expect(
    ductsGraph.transition!(current, { system: ["A", "B", "C", "D", "SA"] }, "page"),
  ).toMatchObject({ patch: { system: ["B", "C", "D", "SA"] } });
});

test("criteria and kinds review rows keep the sheet's words and grouping", () => {
  const criteria = ductsGraph.cells!.find((c) => c.key === "criteria")!;
  expect(
    criteria.show!({ velocityLimitFpm: { supply: 850, return: 700 }, splitPolicy: "even" }),
  ).toBe("velocity limit supply 850 return 700, split policy even");
  expect(criteria.show!({ velocityLimitFpm: { supply: 850 } })).toBe("velocity limit supply 850");
  const kinds = ductsGraph.cells!.find((c) => c.segment === "kinds")!;
  expect(kinds.groupOf(JSON.stringify(["Broan", "B210E75RT"]))).toEqual(["Broan", "B210E75RT"]);
  expect(kinds.show!({ kind: "erv" })).toBe("erv");
  expect(ductsRouteState.schemaVersion).toBe(1);
});

test("fan-stage selection and framing remain Page fields without a network read", () => {
  const current = ductsPageSchema.parse({ stage: "sheet" });
  const patch = {
    selected: "14577391",
    viewport: {
      kind: "orbit" as const,
      yaw: 20,
      elev: 30,
      zoom: 2,
      pivot: [0, 0, 0] as [number, number, number],
    },
  };
  expect(ductsGraph.transition!(current, patch, "page")).toMatchObject({ patch });
  expect(ductsGraph.fields.selected.url).not.toBe(false);
  expect(ductsGraph.fields.viewport.url).not.toBe(false);
});
