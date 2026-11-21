import { expect, test } from "vite-plus/test";
import { BridgeError } from "@pe/host-internal/bridge";
import { bodyOf, evaluate, type InputPort } from "@pe/host-internal/reads/evaluator";
import { product, regionCode } from "@pe/rooms-contract/product";
import "../product.ts";

const ref = { session: "s", openId: "snowdon" };
const FLOOR = "8a0c1e3f-0000-4000-8000-000000000001-000026dc";
const CEILING = "8a0c1e3f-0000-4000-8000-000000000001-0014edcd";
const GONE = "8a0c1e3f-0000-4000-8000-000000000001-00715157";
// Snowdon: one level carries a floor plan and a ceiling plan of one name.
const levels = [
  {
    name: "Snowdon level",
    elevation: 0,
    views: [
      { uniqueId: FLOOR, name: "L2", type: "FloorPlan" },
      { uniqueId: CEILING, name: "L2", type: "CeilingPlan" },
    ],
  },
];
type Native = (key: string, request: Record<string, unknown>) => unknown;
const kept: unknown[] = [];
const port = (native: Native, work: unknown = null, taken: string[] = []): InputPort => ({
  evaluation: "test",
  origin: {},
  revision: () => 0,
  async take(name, args) {
    taken.push(name);
    if (name === "document-mark") return { observedSince: 1, changedAt: null, generation: 0 };
    if (name === "work-scope")
      return { binding: "open", route: "takeoffs", target: null, open: ref };
    if (name === "work") return work;
    if (name === "file:takeoff-capture") {
      kept.push(args);
      return {
        id: "a".repeat(64),
        provenance: { kind: "live", target: ref },
        capturedAt: "2026-11-20T00:00:00.000Z",
        snapshot: {
          reading: {
            at: "C:/Models/Snowdon.rvt",
            version: null,
            observedAt: "2026-11-20T00:00:00.000Z",
          },
          world: { docName: "Snowdon", r10Path: null, lanes: [], zones: [], systems: [] },
          zoneFrs: [],
          regionsByZone: {},
        },
      };
    }
    const call = args as {
      key: string;
      input?: { request?: Record<string, unknown> };
      request?: Record<string, unknown>;
    };
    if (name !== "native") throw Error(`Unexpected input: ${name}`);
    return { body: native(call.key, call.request ?? call.input?.request ?? {}), version: null };
  },
});
const { plans, regions, adoption } = product.readings;
type Data<K extends keyof typeof product.readings> = import("zod").output<
  (typeof product.readings)[K]["handle"]["data"]
>;

test("a plan that left the document refuses that selection, and the same document still lists its plans", async () => {
  const asked: string[] = [];
  const native: Native = (key) => {
    asked.push(key);
    if (key === "rooms.roster") return { levels, regions: [] };
    throw new BridgeError("That view is not in this document.", 400, {
      dispatched: true,
      issues: [
        {
          instancePath: "$.view",
          code: "RoomsViewMissing",
          message: "That view is not in this document.",
          severity: "error",
        },
      ],
    });
  };
  const gone = await evaluate(bodyOf(regions.handle), { target: ref, view: GONE }, port(native));
  expect(gone.data).toEqual({
    missing: "That view is not in this document.",
    regions: [],
    unreadable: [],
  });
  const roster = await evaluate(bodyOf(plans.handle), { target: ref }, port(native));
  expect(asked).toEqual(["rooms.snapshot", "rooms.roster"]);
  // Two plans of one name stay two choices: the key is the view's UniqueId, the type tells them apart.
  expect((roster.data as Data<"plans">).levels[0]!.views).toEqual([
    { view: FLOOR, name: "L2", type: "FloorPlan" },
    { view: CEILING, name: "L2", type: "CeilingPlan" },
  ]);
});

test("no plan chosen reads nothing from the model, and another failure is never an empty plan", async () => {
  const native: Native = (key) => {
    throw Error(`Unexpected native read: ${key}`);
  };
  const none = await evaluate(bodyOf(regions.handle), { target: ref, view: "" }, port(native));
  expect(none.data).toEqual({ missing: null, regions: [], unreadable: [] });
  // Any other failure of the plan read stays a failure: a lost bridge is never "no rooms".
  await expect(
    evaluate(bodyOf(regions.handle), { target: ref, view: GONE }, port(native)),
  ).rejects.toThrow("Unexpected native read: rooms.snapshot");
});

test("adoption rows are keyed by the plan's UniqueId, carry the staged choice, and each read of chosen plans is kept as a capture", async () => {
  const requests: [string, unknown][] = [];
  let removedAfterCandidates = false;
  const native: Native = (key, request) => {
    requests.push([key, request]);
    if (key === "rooms.roster") return { levels, regions: [] };
    if (
      key === "takeoffs.snapshot" &&
      removedAfterCandidates &&
      (request.views as string[]).includes(CEILING)
    )
      throw new BridgeError("That view is not in this document.", 400, {
        dispatched: true,
        issues: [
          {
            instancePath: "$.view",
            code: "RoomsViewMissing",
            message: "Plan missing",
            severity: "error",
          },
        ],
      });
    if (key === "takeoffs.snapshot")
      return {
        reading: {
          at: "C:/Models/Snowdon.rvt",
          version: null,
          observedAt: "2026-11-20T00:00:00.000Z",
        },
        snapshot: {
          status: {
            systems: [],
          },
          unreadable: [],
          zoneFrs: [],
          regionsByZone: {},
        },
      };
    if (key === "takeoffs.candidates")
      return {
        regions: [
          {
            elementId: 21,
            uniqueId: "office-zone-00000015",
            typeName: "Office zone",
            view: "L2",
            viewUniqueId: request.view,
            color: "10,20,30",
            sqft: 100,
            blob: "",
            loops: [],
          },
        ],
      };
    throw Error(`Unexpected native read: ${key}`);
  };
  const taken: string[] = [];
  const staged = {
    doc: {
      adopt: {
        [`${CEILING}:21`]: {
          edit: { by: "human", value: { checked: true, name: "West office", systemTag: "AHU-1" } },
        },
      },
    },
    revision: 1,
  };
  const read = await evaluate(
    bodyOf(adoption.handle),
    { target: ref, views: [FLOOR, CEILING] },
    port(native, staged, taken),
  );
  const data = read.data as Data<"adoption">;
  expect(data.rows.map((row) => [row.key, row.checked, row.name, row.systemTag])).toEqual([
    [`${FLOOR}:21`, false, "Office zone", ""],
    [`${CEILING}:21`, true, "West office", "AHU-1"],
  ]);
  // The native boundary is asked by UniqueId, never by the shared name "L2".
  expect(requests.filter(([key]) => key === "takeoffs.candidates")).toEqual([
    ["takeoffs.candidates", { view: FLOOR }],
    ["takeoffs.candidates", { view: CEILING }],
  ]);
  // The capture names each chosen plan with its display facts; the two L2 plans stay two.
  expect(kept).toMatchObject([
    {
      target: ref,
      views: [
        { name: "L2", level: "Snowdon level" },
        { name: "L2", level: "Snowdon level" },
      ],
    },
  ]);
  removedAfterCandidates = true;
  const raced = await evaluate(
    bodyOf(adoption.handle),
    { target: ref, views: [FLOOR, CEILING] },
    port(native, staged),
  );
  expect(raced.data).toMatchObject({
    rows: [{ view: FLOOR, name: "Office zone" }],
  });
  const none = await evaluate(
    bodyOf(adoption.handle),
    { target: ref, views: [] },
    port(native, null, ((taken.length = 0), taken)),
  );
  expect((none.data as Data<"adoption">).rows).toEqual([]);
  expect(taken).not.toContain("file:takeoff-capture");
});

test("a region's Work key is its UniqueId SubjectRef, the same code the regions read answers with", () => {
  expect(() => regionCode("9948")).toThrow();
});
