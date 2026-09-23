import { expect, test } from "vite-plus/test";
import { address, familiesRouteState, familyCellKey } from "@pe/agent-contracts";

import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { hostLoadedFamilies, type HostCall } from "../src/pea/families-admission.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";

const at = address("c:\\models\\j1.rvt");
const scope = { route: "families", target: at };
// One loaded family, "Casework", with one type. Its element id changes on every reload; its name does not.
const loaded = [{ familyId: 3573700, familyName: "Casework", types: [{ typeName: "12 X 4" }] }];

// The person staged the Casework scope; cell keys are checked against it (M13-2).
function workspace() {
  const staged = { version: 1, revision: 0, doc: { scope: { staged: { value: casework([]) } } } };
  const saved = new Map<string, unknown>();
  const reads: unknown[] = [];
  return {
    reads,
    work: new RouteWorkspace({
      registrations: createRouteRegistrations({
        hostBaseUrl: "http://127.0.0.1:1",
        loadedFamilies: async (target, filter) => {
          reads.push({ target, filter });
          return loaded;
        },
      }),
      store: {
        getState: async ({ targetKey, route }) => saved.get(`${targetKey}\0${route}`) ?? staged,
        setState: async ({ targetKey, route, value }) => {
          saved.set(`${targetKey}\0${route}`, value);
        },
      },
    }),
  };
}
const propose = (familyName: string, typeName = "12 X 4") => ({
  path: [
    "cells",
    familyCellKey({ familyName, typeName, parameter: "View Description" }),
    "proposal",
  ],
  value: { value: { value: "Base", storageType: "String" } },
});

test("F-J1-7: a proposal naming no loaded family is refused at the door, naming the key", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "agent", [propose("Casework 2")], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
  if (refused.ok) return;
  expect(refused).toMatchObject({ code: "unknown-family-type" });
  if (!("agentHint" in refused)) return;
  expect(refused.agentHint).toContain('["Casework 2","12 X 4","View Description"]');
  expect(refused.agentHint).toContain('e.g. ["Casework","12 X 4",');
  expect((await work.view(scope, "families"))!.revision).toBe(0);
});

test("an element id in the family slot is refused by the schema, before Revit is asked", async () => {
  const { work, reads } = workspace();
  const key = JSON.stringify([3573700, "12 X 4", "View Description"]);
  const refused = await work.apply(
    scope,
    "families",
    "agent",
    [
      {
        path: ["cells", key, "proposal"],
        value: { value: { value: "Base", storageType: "String" } },
      },
    ],
    0,
  );
  expect(refused).toMatchObject({ ok: false });
  expect(reads).toHaveLength(0);
});

test("a type the family does not have is refused, a human write too", async () => {
  const { work } = workspace();
  const refused = await work.apply(scope, "families", "human", [propose("Casework", "24 X 4")], 0);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
});

test("a valid key lands, and clearing a cell never asks Revit", async () => {
  const { work, reads } = workspace();
  const landed = await work.apply(scope, "families", "agent", [propose("Casework")], 0);
  expect(landed).toMatchObject({ ok: true, revision: 1 });
  expect(reads).toEqual([{ target: at, filter: casework([]) }]);
  const key = familyCellKey({
    familyName: "Casework",
    typeName: "12 X 4",
    parameter: "View Description",
  });
  const withdrawn = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["cells", key, "proposal"], value: null }],
    1,
  );
  expect(withdrawn).toMatchObject({ ok: true });
  expect(reads).toHaveLength(1);
  expect(
    familiesRouteState.schema.parse((await work.view(scope, "families"))!.doc).cells[key],
  ).toMatchObject({ proposal: null });
});

test("an exclusion carries its writer: Pea cannot write one as the person, nor lift the person's", async () => {
  const { work, reads } = workspace();
  const exclude = (by: string) => [{ path: ["excluded", "Casework"], value: { by } }];
  expect(await work.apply(scope, "families", "agent", exclude("person"), 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
  expect(await work.apply(scope, "families", "human", exclude("pea"), 0)).toMatchObject({
    ok: false,
  });
  const held = await work.apply(scope, "families", "human", exclude("person"), 0);
  expect(held).toMatchObject({ ok: true, revision: 1 });
  const lifted = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["excluded", "Casework"] }],
    1,
  );
  expect(lifted).toMatchObject({ ok: false, kind: "refused" });
  expect(reads).toHaveLength(0);
});

// F-J1-12, from hold 4b's recorded shapes (thread 1da7e887): the session list and the catalog as
// the C# collector answers. It lists types only for a Rows/Full view, at most maxSamplesPerEntry
// (default 10), and warns when the filter matches nothing.
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
    const names: string[] = request.filter?.familyNames ?? [];
    const categories: string[] = request.filter?.categoryNames ?? [];
    const families = [exhaust].filter(
      (f) =>
        (!names.length || names.includes(f.familyName)) &&
        (!categories.length || categories.includes(f.categoryName)),
    );
    const full = ["Rows", "Full"].includes(request.projection?.view);
    return {
      summary: { truncated: false },
      families: families.map((f) => ({
        ...f,
        typeCount: f.types.length,
        types: full ? f.types.slice(0, request.budget?.maxSamplesPerEntry ?? 10) : [],
      })),
      issues: families.length
        ? []
        : [
            {
              code: "LoadedFamiliesFilterMatchedZeroFamilies",
              message: "Loaded-family filter matched zero families out of 1.",
            },
          ],
    };
  }) as HostCall;

function ProjectAWork(familyNames: string[], categoryNames = ["Air Terminals"]) {
  const target = address(projectA);
  const saved = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: createRouteRegistrations({
      loadedFamilies: hostLoadedFamilies(undefined, liveHost()),
    }),
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => void saved.set(route, value),
    },
  });
  const at = { route: "families", target };
  const scoped = { categoryNames, familyNames, placementScope: "AllLoaded" };
  return {
    work,
    at,
    author: () =>
      work.apply(
        at,
        "families",
        "human",
        [{ path: ["scope", "staged"], value: { value: scoped } }],
        0,
      ),
  };
}

test("F-J1-12: the live catalog loopback admits a key for a type past the tenth, as Pea and as the person", async () => {
  const { work, at, author } = ProjectAWork(["Price LBP15A Exhaust"]);
  expect(await author()).toMatchObject({ ok: true, revision: 1 });
  const landed = await work.apply(at, "families", "agent", [propose("Price LBP15A Exhaust")], 1);
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
          "staged",
        ],
        value: { value: { value: "", storageType: "String" } },
      },
    ],
    2,
  );
  expect(cleared).toMatchObject({ ok: true, revision: 3 });
});

test("F-J1-12: a scope that resolves to no loaded family refuses with that diagnosis, not a key hint", async () => {
  // Nothing is loaded under Walls, e.g. its one family was unloaded after the person staged this.
  const { work, at, author } = ProjectAWork([], ["Walls"]);
  expect(await author()).toMatchObject({ ok: true, revision: 1 });
  const refused = await work.apply(at, "families", "agent", [propose("Price LBP15A Exhaust")], 1);
  expect(refused).toMatchObject({ ok: false, kind: "refused" });
  if (refused.ok) return;
  if (!("agentHint" in refused)) return;
  expect(refused.agentHint).toContain(
    "scope resolved to no loaded families: Loaded-family filter matched zero families out of 1.",
  );
  expect(refused.agentHint).not.toContain("A key is");
});

const casework = (familyNames: string[]) => ({
  categoryNames: ["Casework"],
  familyNames,
  placementScope: "AllLoaded",
});

test("F-J1-10: Pea proposes a scope and the person's staged scope is untouched", async () => {
  const { work } = workspace();
  const staged = await work.apply(
    scope,
    "families",
    "human",
    [{ path: ["scope", "staged"], value: { value: casework(["Casework"]) } }],
    0,
  );
  expect(staged).toMatchObject({ ok: true, revision: 1 });
  const proposed = await work.apply(
    scope,
    "families",
    "agent",
    [{ path: ["scope", "proposal"], value: { value: casework([]), note: "all casework" } }],
    1,
  );
  expect(proposed).toMatchObject({ ok: true, revision: 2 });
  for (const path of [["scope"], ["scope", "staged"]])
    expect(await work.apply(scope, "families", "agent", [{ path, value: null }], 2)).toMatchObject({
      ok: false,
    });
  const { scope: cell } = familiesRouteState.schema.parse(
    (await work.view(scope, "families"))!.doc,
  );
  expect(cell.staged).toEqual({ value: casework(["Casework"]) });
  expect(cell.proposal).toMatchObject({ value: casework([]) });
});

test("F-J1-10: a scope write naming an unknown family refuses by name, Pea's or the person's", async () => {
  const { work } = workspace();
  for (const [actor, rung] of [
    ["agent", "proposal"],
    ["human", "staged"],
  ] as const) {
    const refused = await work.apply(
      scope,
      "families",
      actor,
      [
        {
          path: ["scope", rung],
          value: { value: casework(["Casework", "Price LBPH15A Exhaust"]) },
        },
      ],
      0,
    );
    expect(refused).toMatchObject({ ok: false, kind: "refused" });
    if (refused.ok) continue;
    expect(refused).toMatchObject({ families: ["Price LBPH15A Exhaust"] });
    if (!("agentHint" in refused)) continue;
    expect(refused.agentHint).toContain('"Price LBPH15A Exhaust"');
    expect(refused.agentHint).not.toContain('"Casework"');
  }
  expect((await work.view(scope, "families"))!.revision).toBe(0);
});

// M13-1: a stale rung never blocks its own correction. project-a loads only "Price LBP15A Exhaust";
// "Price LBP15A Exhaust Old" was renamed away after it was written, so its rung is stale.
const airTerminals = (familyNames: string[]) => ({
  value: { categoryNames: ["Air Terminals"], familyNames, placementScope: "AllLoaded" },
});

test("M13-1 (a): a stale staged scope does not block Pea's corrected proposal", async () => {
  const { work, at } = seededWork({
    scope: { staged: airTerminals(["Price LBP15A Exhaust Old"]) },
  });
  const landed = await work.apply(
    at,
    "families",
    "agent",
    [{ path: ["scope", "proposal"], value: airTerminals(["Price LBP15A Exhaust"]) }],
    1,
  );
  expect(landed, JSON.stringify(landed)).toMatchObject({ ok: true, revision: 2 });
});

test("M13-1 (b): a stale proposal does not block the person's corrected staged scope", async () => {
  const { work, at } = seededWork({
    scope: { proposal: airTerminals(["Price LBP15A Exhaust Old"]) },
  });
  const landed = await work.apply(
    at,
    "families",
    "human",
    [{ path: ["scope", "staged"], value: airTerminals(["Price LBP15A Exhaust"]) }],
    1,
  );
  expect(landed, JSON.stringify(landed)).toMatchObject({ ok: true, revision: 2 });
});

/** project-a Work saved at revision 1 holding `doc`, as it reads after the catalog moved under it. */
function seededWork(doc: unknown, host: HostCall = liveHost()) {
  const target = address(projectA);
  const saved = new Map<string, unknown>([["families", { version: 1, revision: 1, doc }]]);
  const calls: any[] = [];
  const work = new RouteWorkspace({
    registrations: createRouteRegistrations({
      loadedFamilies: hostLoadedFamilies(undefined, (async (key: any, request: any, on: any) => {
        if (key === "revit.catalog.loaded-families") calls.push(request);
        return host(key, request, on);
      }) as HostCall),
    }),
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => void saved.set(route, value),
    },
  });
  return { work, at: { route: "families", target }, calls };
}

const exhaustScope = {
  categoryNames: ["Air Terminals"],
  familyNames: ["Price LBP15A Exhaust"],
  placementScope: "AllLoaded",
};

test("M13-2 (d): Pea proposes a scope, then cells in it, with nothing staged; the catalog read carries the proposed filter", async () => {
  const { work, at, calls } = seededWork({});
  const scoped = await work.apply(
    at,
    "families",
    "agent",
    [{ path: ["scope", "proposal"], value: { value: exhaustScope } }],
    1,
  );
  expect(scoped).toMatchObject({ ok: true, revision: 2 });
  const cells = await work.apply(at, "families", "agent", [propose("Price LBP15A Exhaust")], 2);
  expect(cells).toMatchObject({ ok: true, revision: 3 });
  expect(calls.length).toBeGreaterThan(0);
  for (const request of calls) expect(request.filter).toBeDefined();
  expect(calls.at(-1).filter).toEqual(exhaustScope);
  // The same, as ONE write: the scope proposed by an earlier patch keys the cells.
  const one = seededWork({});
  expect(
    await one.work.apply(
      one.at,
      "families",
      "agent",
      [
        { path: ["scope", "proposal"], value: { value: exhaustScope } },
        propose("Price LBP15A Exhaust"),
      ],
      1,
    ),
  ).toMatchObject({ ok: true, revision: 2 });
  expect(one.calls.at(-1).filter).toEqual(exhaustScope);
});

test("M13-2 (e): cells with no scope on either rung refuse by name, and Revit is never asked", async () => {
  const { work, at, calls } = seededWork({});
  for (const actor of ["agent", "human"] as const) {
    const refused = await work.apply(at, "families", actor, [propose("Price LBP15A Exhaust")], 1);
    expect(refused).toMatchObject({ ok: false, kind: "refused" });
    if (refused.ok) continue;
    expect(refused).toMatchObject({ code: "no-scope" });
    if (!("agentHint" in refused)) continue;
    expect(refused.agentHint).toBe(
      "Propose or stage a scope before proposing cells. Nothing was written.",
    );
  }
  expect(calls).toHaveLength(0);
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
const stagedExhaust = { scope: { staged: { value: exhaustScope } } };

test("item 3: every door refusal names its code and its structured parts, and keeps the prose for Pea", async () => {
  const cases: [string, () => Promise<unknown>, Record<string, unknown>][] = [
    [
      "exclusion-held",
      async () => {
        const { work } = workspace();
        await work.apply(
          scope,
          "families",
          "human",
          [{ path: ["excluded", "Casework"], value: { by: "person" } }],
          0,
        );
        return work.apply(scope, "families", "agent", [{ path: ["excluded", "Casework"] }], 1);
      },
      { families: ["Casework"] },
    ],
    [
      "exclusion-author",
      () =>
        workspace().work.apply(
          scope,
          "families",
          "agent",
          [{ path: ["excluded", "Casework"], value: { by: "person" } }],
          0,
        ),
      { families: ["Casework"] },
    ],
    [
      "unknown-family",
      () =>
        workspace().work.apply(
          scope,
          "families",
          "human",
          [
            {
              path: ["scope", "staged"],
              value: { value: casework(["Casework", "Price LBPH15A Exhaust"]) },
            },
          ],
          0,
        ),
      { families: ["Price LBPH15A Exhaust"] },
    ],
    [
      "no-scope",
      () => seededWork({}).work.apply(seededWork({}).at, "families", "agent", [exhaustCell], 1),
      {},
    ],
    [
      "unknown-family-type",
      () => workspace().work.apply(scope, "families", "agent", [propose("Casework 2")], 0),
      { cells: [{ familyName: "Casework 2", typeName: "12 X 4", parameter: "View Description" }] },
    ],
    [
      "scope-unresolved",
      () => {
        const { work, at } = seededWork({
          scope: {
            staged: { value: { ...exhaustScope, categoryNames: ["Walls"], familyNames: [] } },
          },
        });
        return work.apply(at, "families", "agent", [exhaustCell], 1);
      },
      {},
    ],
    [
      "scope-truncated",
      () => {
        const { work, at } = seededWork(stagedExhaust, catalogOf([], true));
        return work.apply(at, "families", "agent", [exhaustCell], 1);
      },
      {},
    ],
    [
      "types-truncated",
      () => {
        const { work, at } = seededWork(
          stagedExhaust,
          catalogOf([{ ...exhaust, typeCount: 13, types: exhaust.types }]),
        );
        return work.apply(at, "families", "agent", [exhaustCell], 1);
      },
      { families: ["Price LBP15A Exhaust"] },
    ],
    [
      "document-unavailable",
      () => {
        const { work, at } = seededWork(
          stagedExhaust,
          casing((key) => (key === "bridge.sessions.list" ? { sessions: [] } : undefined)),
        );
        return work.apply(at, "families", "agent", [exhaustCell], 1);
      },
      {},
    ],
    [
      "catalog-unreachable",
      () => {
        const { work, at } = seededWork(
          stagedExhaust,
          casing((key) => {
            if (key === "revit.catalog.loaded-families") throw Error("socket hang up");
          }),
        );
        return work.apply(at, "families", "agent", [exhaustCell], 1);
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
