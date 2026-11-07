import { expect, test, vi } from "vite-plus/test";
import {
  address,
  familiesRouteState,
  familyDraftRouteState,
  parameterLinksRouteState,
  START_FRESH_ASIDE,
  takeoffsRouteState,
  workKey,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import type { z } from "zod";
import { RouteWorkspace } from "../src/route-workspace.ts";

const target = address("C:\\Models\\Old.rvt");
// Exactly what the pre-cells contracts persisted (`fb3d7b9`): arrays of edits and accepts.
const oldFamilies = {
  version: 1,
  revision: 7,
  doc: {
    scope: null,
    excludedIds: [],
    edits: [
      {
        familyId: 1,
        familyName: "F",
        typeName: "T",
        parameter: "P",
        value: "pea",
        by: "pea",
      },
    ],
    accepted: [
      {
        familyId: 1,
        familyName: "F",
        typeName: "T",
        parameter: "P",
        value: "pea",
        by: "human",
      },
    ],
  },
};
const oldFamily = {
  version: 1,
  revision: 3,
  doc: {
    reading: "{}",
    edits: [{ pointer: "/a", value: 1, by: "pea" }],
    accepted: [{ pointer: "/b", delete: true, by: "human" }],
  },
};

// The pre-cells Parameter Links shape: a bare authored draft (the census found 0 rows).
const oldParameterLinks = {
  version: 1,
  revision: 1,
  doc: { draft: { formatVersion: 1, definitions: [], assignments: [] } },
};

// The census's 2 pre-cells Takeoffs rows: one staged room edit, one adopt patch.
const oldTakeoffs = {
  version: 1,
  revision: 3,
  doc: {
    edit: [{ roomId: "room-2", base: { name: "Study" }, next: { name: "Office" } }],
    adoptPatches: { "Main:6248837": { checked: true, name: "Main Level 09" } },
    decisions: {},
    reviewFlags: {},
  },
};

for (const [spec, saved] of [
  [familiesRouteState, oldFamilies],
  [familyDraftRouteState, oldFamily],
  [parameterLinksRouteState, oldParameterLinks],
  [takeoffsRouteState, oldTakeoffs],
] as const) {
  test(`/${spec.route}: undecodable stored Work refuses without rewriting`, async () => {
    const scope: WorkKey = { binding: "address", route: spec.route, target };
    let stored: unknown = structuredClone(saved);
    const setState = vi.fn(async ({ value }: { value: unknown }) => {
      stored = value;
    });
    const module = new RouteWorkspace({
      registrations: [{ spec: spec as unknown as RouteStateSpec<z.ZodType> }],
      store: { getState: async () => structuredClone(stored), setState },
    });
    await expect(module.read(scope, spec.route)).rejects.toMatchObject({
      code: "WorkUnreadable",
      key: scope,
    });
    expect(stored).toEqual(saved);
    expect(setState).not.toHaveBeenCalled();
  });
}

test.each(["human", "pea"] as const)(
  "/families: %s starts fresh without changing old bytes or clobbering an aside",
  async (actor) => {
    const scope: WorkKey = { binding: "address" as const, route: "families", target };
    const key = (route: string) => `${workKey(scope)}\0${route}`;
    const state = new Map<string, unknown>();
    const module = new RouteWorkspace({
      registrations: [
        {
          spec: { ...familiesRouteState, schemaVersion: 2 } as unknown as RouteStateSpec<z.ZodType>,
        },
      ],
      store: {
        getState: async ({ targetKey, route }) =>
          structuredClone(state.get(`${targetKey}\0${route}`)),
        setState: async ({ targetKey, route, value }) =>
          void state.set(`${targetKey}\0${route}`, structuredClone(value)),
      },
    });
    const bytes = JSON.stringify({ ...oldFamilies, schemaVersion: 1 });
    state.set(key("families"), JSON.parse(bytes));

    // ADR 0026: a fresh Work advances the revision past the set-aside one, so a stale
    // expectedRevision from before the start-fresh can never match after it.
    expect(await module.startFresh(scope, "families", actor)).toMatchObject({
      ok: true,
      revision: oldFamilies.revision + 1,
    });
    expect(JSON.stringify(state.get(key(`families${START_FRESH_ASIDE}1`)))).toBe(bytes);
    expect((await module.read(scope, "families"))!.revision).toBe(oldFamilies.revision + 1);
    // Readable Work has nothing to set aside.
    expect(await module.startFresh(scope, "families", actor)).toMatchObject({ ok: false });

    // Unreadable again: the second aside takes the next slot, the first keeps its bytes.
    const second = JSON.stringify({ ...oldFamilies, schemaVersion: 1, revision: 8 });
    state.set(key("families"), JSON.parse(second));
    expect(await module.startFresh(scope, "families", actor)).toMatchObject({ ok: true });
    expect(JSON.stringify(state.get(key(`families${START_FRESH_ASIDE}1`)))).toBe(bytes);
    expect(JSON.stringify(state.get(key(`families${START_FRESH_ASIDE}2`)))).toBe(second);
  },
);

test.each(["human", "pea"] as const)(
  "/families: %s salvages the same old data before and after recovery",
  async (actor) => {
    const scope: WorkKey = { binding: "address" as const, route: "families", target };
    const key = (route: string) => `${workKey(scope)}\0${route}`;
    const state = new Map<string, unknown>();
    const module = new RouteWorkspace({
      registrations: [
        {
          spec: { ...familiesRouteState, schemaVersion: 2 } as unknown as RouteStateSpec<z.ZodType>,
        },
      ],
      store: {
        getState: async ({ targetKey, route }) =>
          structuredClone(state.get(`${targetKey}\0${route}`)),
        setState: async ({ targetKey, route, value }) =>
          void state.set(`${targetKey}\0${route}`, structuredClone(value)),
      },
    });
    expect(await module.salvage(scope, "families")).toBeNull();
    const bytes = JSON.stringify({
      ...oldFamilies,
      schemaVersion: 1,
      doc: { ...oldFamilies.doc, excludedIds: [3102, 7] },
    });
    state.set(key("families"), JSON.parse(bytes));
    expect(await module.salvage(scope, "families")).toEqual({
      from: "unreadable",
      value: { familyNames: [], familyIds: [3102, 7] },
    });
    expect(await module.startFresh(scope, "families", actor)).toMatchObject({ ok: true });
    expect(await module.salvage(scope, "families")).toEqual({
      from: "aside:1",
      value: { familyNames: [], familyIds: [3102, 7] },
    });
    // The id-keyed record Mission 11 wrote is old Work too; the newest aside answers.
    state.set(key("families"), {
      version: 1,
      schemaVersion: 1,
      revision: 2,
      doc: { excluded: { "41": { by: "person" } } },
    });
    expect(await module.startFresh(scope, "families", actor)).toMatchObject({ ok: true });
    expect(await module.salvage(scope, "families")).toEqual({
      from: "aside:2",
      value: { familyNames: [], familyIds: [41] },
    });
    // Read-only: nothing moved.
    expect(JSON.stringify(state.get(key(`families${START_FRESH_ASIDE}1`)))).toBe(bytes);
  },
);
