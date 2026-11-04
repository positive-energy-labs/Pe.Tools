import { Effect, Exit, Layer, Scope } from "effect";
import { admittedBuiltinsLayer } from "../../../apps/host/src/admitted-builtins.ts";
import { builtinEnrollments } from "../../../apps/host/src/builtin-enrollment.ts";
import { afterEach, expect, test } from "vite-plus/test";
import { address, familiesRouteState, familyCellKey } from "@pe/agent-contracts";

import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { hostLoadedFamilies, type HostCall } from "../src/pea/families-admission.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function admittedWorkspace(
  loadedFamilies: import("../src/pea/families-admission.ts").LoadedFamilies,
  initial?: unknown,
) {
  const saved = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: [],
    store: {
      getState: async ({ targetKey, route }) => saved.get(`${targetKey}\0${route}`) ?? initial,
      setState: async ({ targetKey, route, value }) => {
        saved.set(`${targetKey}\0${route}`, value);
      },
    },
  });
  const scope = await Effect.runPromise(Scope.make());
  cleanup.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  await Effect.runPromise(
    Layer.buildWithScope(
      admittedBuiltinsLayer(
        work,
        builtinEnrollments.filter((entry) => entry.routeKey === "families"),
        createRouteRegistrations({ admittedKeys: [], loadedFamilies }),
      ),
      scope,
    ),
  );
  return work;
}

const at = address("c:\\models\\j1.rvt");
const scope = { binding: "address" as const, route: "families", target: at };
// One loaded family, "Casework", with one type. Its element id changes on every reload; its name does not.
const loaded = [{ familyId: 3573700, familyName: "Casework", types: [{ typeName: "12 X 4" }] }];

// The person edit the Casework scope; cell keys are checked against it (M13-2).
async function workspace() {
  const reads: unknown[] = [];
  const work = await admittedWorkspace(
    async (target, filter) => {
      reads.push({ target, filter });
      return loaded;
    },
    { version: 1, revision: 0, doc: { scope: { edit: { value: casework([]) } } } },
  );
  return { reads, work };
}
const propose = (familyName: string, typeName = "12 X 4") => ({
  path: [
    "cells",
    familyCellKey({ familyName, typeName, parameter: "View Description" }),
    "suggestion",
  ],
  value: { value: { value: "Base", storageType: "String" } },
});

// F-J1-12, from hold 4b's recorded shapes (thread 1da7e887): the session list and the catalog as
// the C# collector answers. The port checks the requested projection and budget against the
// independent twelve-type response instead of reimplementing native filtering and pagination.
const projectA = "f2933e8d-9e16-4bf4-b9ca-484f461e4563";
const exhaust = {
  familyId: 3700298,
  familyUniqueId: "2b3da566-211f-4400-924e-3e29b481ab08-0038764a",
  familyName: "Price LBP15A Exhaust",
  categoryName: "Air Terminals",
  placedInstanceCount: 51,
  types: ["12 X 4", "12 X 4 W", "12 X 6 W", "16 x 8 clg", "6x6", "8 X 4", "8 X 4 W", "84 X 4 T"]
    .concat(Array.from({ length: 4 }, (_, i) => `extra ${i}`))
    .map((typeName) => ({ typeName })),
};
const liveHost = (): HostCall =>
  (async (key: string, request: any) => {
    if (key === "bridge.sessions.list")
      return {
        sessions: [
          {
            connected: true,
            sessionId: "session-0875810ce11c3ab9",
            openDocuments: [
              { openId: "4f27e503561449978eab2c0d293ebd38", address: projectA, isActive: true },
            ],
          },
        ],
      };
    expect(key).toBe("revit.catalog.loaded-families");
    expect(request.projection).toEqual({ view: "Rows" });
    expect(request.budget.maxSamplesPerEntry).toBeGreaterThanOrEqual(12);
    return { summary: { truncated: false }, families: [{ ...exhaust, typeCount: 12 }] };
  }) as HostCall;

async function ProjectAWork(familyNames: string[], categoryNames = ["Air Terminals"]) {
  const target = address(projectA);
  const work = await admittedWorkspace(hostLoadedFamilies(undefined, liveHost()));
  const at = { binding: "address" as const, route: "families", target };
  const scoped = { categoryNames, familyNames, placementScope: "AllLoaded" };
  return {
    work,
    at,
    author: () =>
      work.apply(
        at,
        "families",
        "human",
        [{ path: ["scope", "edit"], value: { value: scoped } }],
        0,
      ),
  };
}

test("F-J1-12: the live catalog loopback admits a key for a type past the tenth, as Pea and as the person", async () => {
  const { work, at, author } = await ProjectAWork(["Price LBP15A Exhaust"]);
  expect(await author()).toMatchObject({ ok: true, revision: 1 });
  const landed = await work.apply(at, "families", "pea", [propose("Price LBP15A Exhaust")], 1);
  expect(landed).toMatchObject({ ok: true, revision: 2 });
  const cleared = await work.apply(
    at,
    "families",
    "human",
    [
      {
        path: [
          "cells",
          familyCellKey({
            familyName: "Price LBP15A Exhaust",
            typeName: "extra 3",
            parameter: "Mech Equip Model Number",
          }),
          "edit",
        ],
        value: { value: { value: "", storageType: "String" } },
      },
    ],
    2,
  );
  expect(cleared).toMatchObject({ ok: true, revision: 3 });
});

const casework = (familyNames: string[]) => ({
  categoryNames: ["Casework"],
  familyNames,
  placementScope: "AllLoaded",
});

test("both authors share editable family scope and optional suggestions", async () => {
  const { work } = await workspace();
  expect(
    await work.apply(
      scope,
      "families",
      "human",
      [{ path: ["scope", "edit"], value: { value: casework(["Casework"]) } }],
      0,
    ),
  ).toMatchObject({ ok: true, revision: 1 });
  expect(
    await work.apply(
      scope,
      "families",
      "pea",
      [{ path: ["scope", "suggestion"], value: { value: casework([]), note: "all casework" } }],
      1,
    ),
  ).toMatchObject({ ok: true, revision: 2 });
  expect(
    await work.apply(
      scope,
      "families",
      "pea",
      [{ path: ["scope", "edit"], value: { value: casework([]) } }],
      2,
    ),
  ).toMatchObject({ ok: true, revision: 3 });
  const { scope: cell } = familiesRouteState.schema.parse(
    (await work.view(scope, "families"))!.doc,
  );
  expect(cell.edit).toMatchObject({ value: casework([]), by: "pea", base: 2 });
  expect(cell.suggestion).toMatchObject({ value: casework([]), by: "pea", base: 1 });
});

// M13-1: a stale rung never blocks its own correction. project-a loads only "Price LBP15A Exhaust";
// "Price LBP15A Exhaust Old" was renamed away after it was written, so its rung is stale.

/** project-a Work saved at revision 1 holding `doc`, as it reads after the catalog moved under it. */
async function seededWork(doc: unknown, host: HostCall = liveHost()) {
  const target = address(projectA);
  const calls: any[] = [];
  const work = await admittedWorkspace(
    hostLoadedFamilies(undefined, (async (key: any, request: any, on: any) => {
      if (key === "revit.catalog.loaded-families") calls.push(request);
      return host(key, request, on);
    }) as HostCall),
    { version: 1, revision: 1, doc },
  );
  return { work, at: { binding: "address" as const, route: "families", target }, calls };
}

const exhaustScope = {
  categoryNames: ["Air Terminals"],
  familyNames: ["Price LBP15A Exhaust"],
  placementScope: "AllLoaded",
};

test("M13-2 (d): Pea proposes a scope, then cells in it, with nothing edit; the catalog read carries the proposed filter", async () => {
  const { work, at, calls } = await seededWork({});
  const scoped = await work.apply(
    at,
    "families",
    "pea",
    [{ path: ["scope", "suggestion"], value: { value: exhaustScope } }],
    1,
  );
  expect(scoped).toMatchObject({ ok: true, revision: 2 });
  const cells = await work.apply(at, "families", "pea", [propose("Price LBP15A Exhaust")], 2);
  expect(cells).toMatchObject({ ok: true, revision: 3 });
  expect(calls.length).toBeGreaterThan(0);
  for (const request of calls) expect(request.filter).toBeDefined();
  expect(calls.at(-1).filter).toEqual(exhaustScope);
  // The same, as ONE write: the scope proposed by an earlier patch keys the cells.
  const one = await seededWork({});
  expect(
    await one.work.apply(
      one.at,
      "families",
      "pea",
      [
        { path: ["scope", "suggestion"], value: { value: exhaustScope } },
        propose("Price LBP15A Exhaust"),
      ],
      1,
    ),
  ).toMatchObject({ ok: true, revision: 2 });
  expect(one.calls.at(-1).filter).toEqual(exhaustScope);
});

// Item 3: the door's refusal is structured. The web draws `code` and its parts; Pea reads `agentHint`.
const casing = (answer: (key: string, request: any) => unknown): HostCall =>
  (async (key: string, request: any, on: any) =>
    (await answer(key, request)) ?? liveHost()(key as any, request, on)) as HostCall;
const catalogOf = (families: unknown[], truncated = false) =>
  casing((key) =>
    key === "revit.catalog.loaded-families" ? { summary: { truncated }, families } : undefined,
  );
const exhaustCell = propose("Price LBP15A Exhaust");
const stagedExhaust = { scope: { edit: { value: exhaustScope } } };

test("item 3: every door refusal names its code and its structured parts, and keeps the prose for Pea", async () => {
  const cases: [string, () => Promise<unknown>, Record<string, unknown>][] = [
    [
      "unknown-family",
      async () =>
        (await workspace()).work.apply(
          scope,
          "families",
          "human",
          [
            {
              path: ["scope", "edit"],
              value: { value: casework(["Casework", "Price LBPH15A Exhaust"]) },
            },
          ],
          0,
        ),
      { families: ["Price LBPH15A Exhaust"] },
    ],
    [
      "no-scope",
      async () => {
        const f = await seededWork({});
        return f.work.apply(f.at, "families", "pea", [exhaustCell], 1);
      },
      {},
    ],
    [
      "unknown-family-type",
      async () =>
        (await workspace()).work.apply(scope, "families", "pea", [propose("Casework 2")], 0),
      { cells: [{ familyName: "Casework 2", typeName: "12 X 4", parameter: "View Description" }] },
    ],
    [
      "scope-unresolved",
      async () => {
        const { work, at } = await seededWork(
          {
            scope: {
              edit: { value: { ...exhaustScope, categoryNames: ["Walls"], familyNames: [] } },
            },
          },
          catalogOf([]),
        );
        return work.apply(at, "families", "pea", [exhaustCell], 1);
      },
      {},
    ],
    [
      "scope-truncated",
      async () => {
        const { work, at } = await seededWork(stagedExhaust, catalogOf([], true));
        return work.apply(at, "families", "pea", [exhaustCell], 1);
      },
      {},
    ],
    [
      "types-truncated",
      async () => {
        const { work, at } = await seededWork(
          stagedExhaust,
          catalogOf([{ ...exhaust, typeCount: 13, types: exhaust.types }]),
        );
        return work.apply(at, "families", "pea", [exhaustCell], 1);
      },
      { families: ["Price LBP15A Exhaust"] },
    ],
    [
      "document-unavailable",
      async () => {
        const { work, at } = await seededWork(
          stagedExhaust,
          casing((key) => (key === "bridge.sessions.list" ? { sessions: [] } : undefined)),
        );
        return work.apply(at, "families", "pea", [exhaustCell], 1);
      },
      {},
    ],
    [
      "catalog-unreachable",
      async () => {
        const { work, at } = await seededWork(
          stagedExhaust,
          casing((key) => {
            if (key === "revit.catalog.loaded-families") throw Error("socket hang up");
          }),
        );
        return work.apply(at, "families", "pea", [exhaustCell], 1);
      },
      {},
    ],
  ];
  for (const [code, write, parts] of cases) {
    const refused = (await write()) as Record<string, unknown>;
    expect(refused, code).toMatchObject({ ok: false, code, ...parts });
    expect(typeof refused.agentHint, code).toBe("string");
    expect(refused, code).not.toHaveProperty("error");
    expect(refused, code).not.toHaveProperty("hint");
  }
});
