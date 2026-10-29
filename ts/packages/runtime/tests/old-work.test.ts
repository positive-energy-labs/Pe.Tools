/**
 * Obligation 12: an old-shape persisted Work document is fail-closed. No read, reload, human or
 * Pea write rewrites or deletes its bytes, and every path answers with one readable sentence. Only
 * explicit start fresh moves them, unchanged, aside.
 */
import { expect, test, vi } from "vite-plus/test";
import {
  address,
  familiesRouteState,
  familyDraftRouteState,
  parameterLinksRouteState,
  START_FRESH_ASIDE,
  takeoffsRouteState,
  UNREADABLE_WORK,
  workKey,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import type { z } from "zod";
import { observeResources, resourceResponse } from "../src/resource-stream.ts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { convertLegacyWork } from "../src/work-cutover.ts";

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
  test(`/${spec.route}: old-shape Work is left byte-for-byte and refused in one sentence`, async () => {
    const scope: WorkKey = { binding: "address" as const, route: spec.route, target };
    const bytes = JSON.stringify(saved);
    const state = new Map([[`${workKey(scope)}\0${spec.route}`, JSON.parse(bytes) as unknown]]);
    const setState = vi.fn(async () => {});
    const module = new RouteWorkspace({
      registrations: [{ spec: spec as unknown as RouteStateSpec<z.ZodType> }],
      store: {
        getState: async ({ targetKey, route }) =>
          structuredClone(state.get(`${targetKey}\0${route}`)),
        setState,
      },
    });

    // Read, and a reload (a second read).
    await expect(module.read(scope, spec.route)).rejects.toThrow(UNREADABLE_WORK);
    await expect(module.read(scope, spec.route)).rejects.toThrow(UNREADABLE_WORK);
    // A human write and a Pea write, each at the saved revision.
    for (const actor of ["human", "pea"] as const)
      expect(
        await module.apply(scope, spec.route, actor, [{ path: ["excludedIds"], value: [] }], 0),
      ).toMatchObject({ ok: false, error: UNREADABLE_WORK });
    // The Work Reading stream says the same sentence.
    const scopes = { observe: () => () => {} };
    const abort = new AbortController();
    const response = resourceResponse(
      new Request(
        `http://host/pe/resources?${new URLSearchParams({ keys: JSON.stringify([{ kind: "work", ...scope }]) }).toString()}`,
        { signal: abort.signal },
      ),
      observeResources(module, scopes),
    );
    const { value } = await response.body!.getReader().read();
    abort.abort();
    expect(JSON.parse(new TextDecoder().decode(value).slice(6))).toMatchObject({
      kind: "failure",
      error: UNREADABLE_WORK,
    });

    expect(setState).not.toHaveBeenCalled();
    expect(JSON.stringify(state.get(`${workKey(scope)}\0${spec.route}`))).toBe(bytes);
  });
}

test("/family: shared suggestions retain either author; legacy slots require explicit conversion", async () => {
  const scope: WorkKey = { binding: "address" as const, route: "family", target };
  const state = new Map<string, unknown>();
  const setState = vi.fn(async () => {});
  const module = new RouteWorkspace({
    registrations: [{ spec: familyDraftRouteState as unknown as RouteStateSpec<z.ZodType> }],
    store: { getState: async () => structuredClone(state.get("doc")), setState },
  });

  for (const by of ["human", "pea"] as const) {
    const legacy = {
      version: 1,
      revision: 2,
      doc: { reading: "{}", cells: { "/a": { proposal: { value: 1, by }, staged: null } } },
    };
    const bytes = JSON.stringify(legacy);
    state.set("doc", JSON.parse(bytes));
    await expect(module.read(scope, "family")).rejects.toThrow(UNREADABLE_WORK);
    expect(setState).not.toHaveBeenCalled();
    expect(JSON.stringify(state.get("doc"))).toBe(bytes);

    // Startup cutover is explicit. Reading Work never infers or discards an author.
    const converted = convertLegacyWork(legacy, "family");
    state.set("doc", converted);
    expect(await module.read(scope, "family")).toMatchObject({
      revision: 2,
      doc: {
        reading: "{}",
        cells: { "/a": { suggestion: { value: 1, by, at: null, base: null }, edit: null } },
      },
    });
    expect(setState).not.toHaveBeenCalled();
    expect(state.get("doc")).toEqual(converted);
    expect(JSON.stringify(legacy)).toBe(bytes);
  }
});

test.each(["human", "pea"] as const)(
  "/families: %s starts fresh without changing old bytes or clobbering an aside",
  async (actor) => {
    const scope: WorkKey = { binding: "address" as const, route: "families", target };
    const key = (route: string) => `${workKey(scope)}\0${route}`;
    const state = new Map<string, unknown>();
    const module = new RouteWorkspace({
      registrations: [{ spec: familiesRouteState as unknown as RouteStateSpec<z.ZodType> }],
      store: {
        getState: async ({ targetKey, route }) =>
          structuredClone(state.get(`${targetKey}\0${route}`)),
        setState: async ({ targetKey, route, value }) =>
          void state.set(`${targetKey}\0${route}`, structuredClone(value)),
      },
    });
    const bytes = JSON.stringify(oldFamilies);
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
    const second = JSON.stringify({ ...oldFamilies, revision: 8 });
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
      registrations: [{ spec: familiesRouteState as unknown as RouteStateSpec<z.ZodType> }],
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
