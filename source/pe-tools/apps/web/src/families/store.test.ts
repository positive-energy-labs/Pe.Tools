import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { FamiliesRouteDocument, RouteStateWriteResult } from "@pe/agent-contracts";

import type { FamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";

const emptyEntry = {
  familyId: 1,
  familyName: "Desk",
  plan: {
    parameters: [],
    requiredApsParameterNames: [],
    familyParameterNames: [],
    loweredActions: [{ operation: "set", target: "Width", sources: [], reason: "profile" }],
  },
};
const document = (): FamiliesRouteDocument => ({
  binding: { target: null },
  profilePath: "desk.json",
  plan: { planHash: "hash-1", takenAt: "2026-08-25T00:00:00Z", entries: [emptyEntry] },
  excludedIds: [],
  apply: null,
});
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));
const slice = (doc: FamiliesRouteDocument) => ({
  doc,
  hydrated: true,
  connected: null,
  error: null,
  peaActive: false,
});
const fixture = () => {
  const calls: Array<{ op: string; input: unknown }> = [];
  const ok = async (op: string, input: unknown): Promise<RouteStateWriteResult> => {
    calls.push({ op, input });
    return { ok: true };
  };
  const host: FamiliesHost = {
    sessions: async () => [],
    categories: async () => [],
    families: async () => [],
    profiles: async () => [],
    apply: (patches) => ok("apply", patches),
    command: (name, input) => ok(name, input ?? {}),
    project: async () => ({ projections: [], diagnostics: [] }),
    openPath: async () => ({}),
  };
  return { host, calls };
};
const make = (testFixture = fixture()) => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  const docSlice = Atom.make(AsyncResult.success(slice(document())));
  return {
    registry,
    calls: testFixture.calls,
    store: createFamiliesStore({
      registry,
      scope: { threadId: "thread-1" },
      host: testFixture.host,
      search: { target: "", patch() {} },
      slice: docSlice,
    }),
  };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("families route store", () => {
  it("keeps draft edits separate from applied scope", () => {
    const { registry, store } = make();
    store.actions.setDraft({
      placement: "PlacedOnly",
      categories: ["Mechanical Equipment"],
      families: ["Desk"],
    });
    expect(registry.get(store.atoms.applied)).toBeNull();
  });

  it("copies draft to applied only through apply-scope", async () => {
    const { registry, store } = make();
    store.actions.setDraft({
      placement: "PlacedOnly",
      categories: ["Mechanical Equipment"],
      families: ["Desk"],
    });
    await store.actions.applyScope();
    expect(registry.get(store.atoms.applied)).toEqual({
      placementScope: "PlacedOnly",
      categoryNames: ["Mechanical Equipment"],
      familyNames: ["Desk"],
    });
  });

  it("refuses apply while plan runs", async () => {
    let release!: (value: RouteStateWriteResult) => void;
    const testFixture = fixture();
    testFixture.host.command = (name, input) =>
      name === "plan"
        ? new Promise<RouteStateWriteResult>((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ ok: true, result: input });
    const { store } = make(testFixture);
    store.actions.setDraft({
      placement: "AllLoaded",
      categories: ["Furniture"],
      families: ["Desk"],
    });
    await store.actions.applyScope();
    const planning = store.actions.plan();
    await tick();
    await expect(store.actions.applyFoundry()).rejects.toThrow("another verb is running");
    release({ ok: true });
    await planning;
  });

  it("emits one excludedIds patch", async () => {
    const { calls, store } = make();
    await store.actions.exclude(1);
    expect(calls).toEqual([
      { op: "apply", input: [{ path: ["excludedIds"], value: [1] }] },
    ]);
  });
});
