/**
 * Obligation 12: an old-shape persisted Work document is fail-closed. No read, reload, human or
 * Pea write rewrites or deletes its bytes, and every path answers with one readable sentence.
 */
import { expect, test, vi } from "vite-plus/test";
import {
  address,
  familiesRouteState,
  familyDraftRouteState,
  workKey,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import type { z } from "zod";
import { observeResources, resourceResponse } from "../src/resource-stream.ts";
import { ScopeStore } from "../src/scope-store.ts";
import { RouteWorkspace, UNREADABLE_WORK } from "../src/route-workspace.ts";

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

for (const [spec, saved] of [
  [familiesRouteState, oldFamilies],
  [familyDraftRouteState, oldFamily],
] as const) {
  test(`/${spec.route}: old-shape Work is left byte-for-byte and refused in one sentence`, async () => {
    const scope: WorkKey = { route: spec.route, target };
    const bytes = JSON.stringify(saved);
    const state = new Map([[`${workKey(scope)}\0${spec.route}`, JSON.parse(bytes) as unknown]]);
    const setState = vi.fn(async () => {});
    const module = new RouteWorkspace({
      registrations: [{ spec: spec as unknown as RouteStateSpec<z.ZodType>, handlers: {} }],
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
    for (const actor of ["human", "agent"] as const)
      expect(
        await module.apply(scope, spec.route, actor, [{ path: ["excludedIds"], value: [] }], 0),
      ).toMatchObject({ ok: false, error: UNREADABLE_WORK });
    // The Work Reading stream says the same sentence.
    const scopes = new ScopeStore(
      async () => ({ getState: async () => null, setState: async () => {} }),
      "test",
    );
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
