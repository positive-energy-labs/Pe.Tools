/**
 * The /ducts verbs as the head runs them: bare, over the chosen system. Apply is armed by a fresh
 * preview whatever Fix and Set hold; while they stand only the ESP is left out of the request.
 * The host is a fixture: the request each verb sends is captured, parsed by the real contract.
 */
import { ductsRouteState, type DuctsRouteDocument } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { price } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import type { z } from "zod";

const sent: { key: string; input: Record<string, unknown> }[] = [];
const answer = { value: {} as unknown };
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: async (key: string, input: Record<string, unknown>) => {
    sent.push({ key, input });
    return { id: "a1", state: "done" };
  },
  readAction: async () => undefined,
  actionResult: () => answer,
}));

const { manifest, bindDuctsManifest, reconcileDuctsMembers } = await import("./manifest");
const { stagedEsp } = await import("@pe/ducts-domain/staged");
type Page = import("./manifest").DuctsPage;

const links = [
  [100, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 5],
  [5, 6],
];
const connectors = (id: number) =>
  links
    .filter((pair) => pair.includes(id))
    .map((pair, index) => ({
      index,
      kind: "end" as const,
      point: [id, 0, 0],
      direction: "out" as const,
      shape: "round" as const,
      size: "8 in",
      classification: "Supply Air",
      connectedTo: { elementId: pair.find((other) => other !== id)!, connector: 0 },
    }));
const snapshot = {
  coordinateEncoding: "native-double",
  document: { title: "slice", readAt: "2026-10-21T00:00:00Z", elapsedMs: 1 },
  levels: [{ id: 30, name: "Level 1", elevationFt: 0 }],
  groups: [
    {
      id: "g1",
      rootIds: [100],
      classifications: ["Supply Air"],
      systemNames: ["SA"],
      terminalCount: 2,
      elementCount: 6,
      loops: 0,
      issueIds: [],
    },
  ],
  nodes: [100, 2, 4, 6].map((id) => ({
    id,
    kind: id === 100 ? "equipment" : id === 2 ? "fitting" : "terminal",
    category: "duct node",
    point: [id === 100 ? 0 : id, 0, 0],
    levelId: 30,
    groupId: id === 100 ? null : "g1",
    systemName: id === 100 ? null : "SA",
    connectors: connectors(id),
    facts: id === 100 ? [{ key: "mark", text: "FC-1" }] : [],
  })),
  segments: [1, 3, 5].map((id) => ({
    id,
    kind: "duct",
    curveKind: "line",
    shape: "round",
    size: "8 in",
    diameterIn: 8,
    lengthFt: 2,
    polyline: [
      [id, 0, 0],
      [id + 1, 0, 0],
    ],
    levelId: 30,
    groupId: "g1",
    systemName: "SA",
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: connectors(id),
  })),
  flows: [],
  issues: [],
  layers: [],
  systems: [{ id: 900, name: "SA", classification: "Supply Air", criticalPath: [], sections: [] }],
  slots: {
    fanStatic: "PE_M_Fan_ExternalStaticPressure",
    fanFlow: "PE_M_Fan_AirFlow",
    componentDrop: "Pressure Drop",
    fittingCoefficient: "Pe_C",
    terminalFlow: "PE_M_Grd_AirFlow",
  },
} as unknown as DuctSnapshot;

let page: Page;
const grids: Grids = {};
const ctxOf = (doc: DuctsRouteDocument) => ({
  target: { kind: "document", ref: { session: "s", openId: "d" } },
  readings: {
    ducts: { state: "ready", observation: snapshot },
    tables: { state: "ready", observation: grids },
    pricing: {
      state: "ready",
      observation: {
        input: {
          snapshot,
          grids,
          catalogs: EMPTY_CATALOGS,
          doc,
          revision: 1,
          epoch: page.epoch,
          documentKey: "s/d",
        },
        result: { priced: price(snapshot, grids, doc), ready: readiness(snapshot, doc) },
      },
    },
  },
  work: { doc, revision: 1, write: async () => null },
  page,
  setPage: (next: Partial<Page>) => (page = { ...page, ...next }),
  note: () => {},
  write: async () => null,
});
type Verb = {
  ready: (ctx: never, input?: unknown) => string | null;
  labelNow?: (ctx: never) => string;
  run: (ctx: never, input?: unknown) => Promise<unknown>;
};
const verb = (name: string) => (manifest.actions as unknown as Record<string, Verb>)[name]!;

beforeEach(() => {
  sent.length = 0;
  page = (manifest.page as z.ZodType<Page>).parse({ system: "SA" });
});

const esp = { esp: { "100": { staged: { value: { inWg: 0.5 } } } } };
const flow = { flows: { "4": { staged: { value: { cfm: 100 } } } } };

test("Set rows standing hold back the ESP only: apply arms on a fresh preview, and neither verb sends the ESP", async () => {
  const onlyEsp = ductsRouteState.schema.parse(esp);
  expect(stagedEsp(onlyEsp)).toBe(1);
  // Terminal 6 has no flow: its Set row stands, so a write of nothing but the ESP is refused.
  expect(verb("apply").ready(ctxOf(onlyEsp) as never)).toMatch(
    /^Only the ESP is staged: \d+ to set before the ESP writes$/,
  );

  const doc = ductsRouteState.schema.parse({ ...esp, ...flow });
  const ctx = ctxOf(doc);
  expect(verb("apply").ready(ctx as never)).toBe("Preview first");
  answer.value = { counts: { planned: 1, refused: 0 }, items: [] };
  await verb("preview").run(ctx as never);
  expect(sent.at(-1)!.key).toBe("ducts.preview-losses");
  expect(sent.at(-1)!.input.equipment).toEqual([]);
  expect(sent.at(-1)!.input.terminalFlows).toContainEqual({ id: 4, cfm: 100, source: "override" });
  // The fresh preview arms apply though the Set row still stands.
  expect(verb("apply").ready(ctxOf(doc) as never)).toBeNull();
  await verb("apply").run(ctxOf(doc) as never);
  expect(sent.at(-1)!.key).toBe("ducts.apply-losses");
  expect(sent.at(-1)!.input.equipment).toEqual([]);
});

test("with nothing standing the ESP rides the write", async () => {
  const doc = ductsRouteState.schema.parse({
    ...esp,
    flows: {
      "4": { staged: { value: { cfm: 100 } } },
      "6": { staged: { value: { cfm: 100 } } },
    },
    equipmentFlows: { "100": { staged: { value: { cfm: 200 } } } },
  });
  answer.value = { counts: { planned: 3, refused: 0 }, items: [] };
  await verb("preview").run(ctxOf(doc) as never);
  expect(sent.at(-1)!.input.equipment).toEqual([{ id: 100, externalStaticInWg: 0.5 }]);
});

test("run bare, the fan verbs act on the chosen system's offered fan, in the page's words", async () => {
  const doc = ductsRouteState.schema.parse({});
  expect(verb("fan-preview").labelNow!(ctxOf(doc) as never)).toBe(
    "preview: make FC-1 the fan of SA",
  );
  expect(verb("fan").labelNow!(ctxOf(doc) as never)).toBe("make FC-1 the fan of SA");
  expect(verb("fan-preview").ready(ctxOf(doc) as never)).toBeNull();
  expect(verb("fan").ready(ctxOf(doc) as never)).toBe("Preview it first");
  answer.value = { outcome: "planned", reason: null, check: "FC-1 is the base of SA" };
  await verb("fan-preview").run(ctxOf(doc) as never, {});
  expect(sent.at(-1)).toEqual({
    key: "ducts.preview-assign-fan",
    input: { unitId: 100, systemId: 900 },
  });
  expect(verb("fan").ready(ctxOf(doc) as never)).toBeNull();
  page = { ...page, system: "" };
  expect(verb("fan").ready(ctxOf(doc) as never)).toBe("Choose a system to make its fan");
  expect(verb("fan").labelNow!(ctxOf(doc) as never)).toBe("make the fan");
});

test("selection follows displayed merged networks while foreign claims and unrelated elements stay scoped", () => {
  const foreign = {
    ...snapshot.nodes[1]!,
    id: 200,
    groupId: "g2",
    systemName: "RA",
    connectors: [],
  };
  const unrelated = { ...foreign, id: 300, groupId: "g3", systemName: "Other" };
  const raw = {
    ...snapshot,
    groups: [
      ...snapshot.groups,
      { ...snapshot.groups[0]!, id: "g2", systemNames: ["RA"] },
      { ...snapshot.groups[0]!, id: "g3", systemNames: ["Other"] },
    ],
    nodes: [...snapshot.nodes, foreign, unrelated],
  } as DuctSnapshot;
  const drawn = {
    ...raw,
    groups: [{ ...raw.groups[0]!, systemNames: ["SA", "RA"] }, raw.groups[2]!],
    nodes: raw.nodes.map((n) => (n.groupId === "g2" ? { ...n, groupId: "g1" } : n)),
  };
  const reading = {
    snapshot: raw,
    drawn,
    claims: { c2: { text: "Other system", ids: [200], state: "assumed" as const } },
  };
  const bound = bindDuctsManifest(() => reading);
  const page = manifest.page!.parse({ system: "SA" });
  expect(bound.transition!(page, { selected: "200" }, "page")).not.toHaveProperty("refusal");
  expect(reconcileDuctsMembers({ ...page, selected: "200" }, reading)).toEqual({});
  expect(reconcileDuctsMembers({ ...page, selected: "200" }, { ...reading, drawn: null })).toEqual(
    {},
  );
  expect(bound.transition!(page, { selected: "300" }, "page")).toHaveProperty("refusal");
  expect(bound.transition!(page, { selected: "c2" }, "page")).toHaveProperty("refusal");
});

test("stale pricing refuses readiness and invocation without dispatch", async () => {
  const doc = ductsRouteState.schema.parse(flow);
  const ctx = ctxOf(doc);
  ctx.work.revision = 2;
  expect(verb("preview").ready(ctx as never)).toMatch(/Pricing is refreshing/);
  await expect(verb("preview").run(ctx as never)).rejects.toThrow(/Pricing is refreshing/);
  expect(sent).toEqual([]);
  ctx.work.revision = 1;
  ctx.readings.pricing.observation.input.epoch = -1;
  expect(verb("preview").ready(ctx as never)).toMatch(/Pricing is refreshing/);
  ctx.readings.pricing.observation.input.epoch = page.epoch;
  ctx.readings.pricing.observation.input.documentKey = "s/other";
  expect(verb("preview").ready(ctx as never)).toMatch(/Pricing is refreshing/);
  expect(verb("fan-preview").ready(ctx as never)).toMatch(/Pricing is refreshing/);
});
