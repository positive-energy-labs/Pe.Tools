import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { address, type FamiliesRouteDocument, type RouteStateWriteResult } from "@pe/agent-contracts";

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
const document = (documentId = "C:\\Models\\Test.rvt"): FamiliesRouteDocument => ({
  binding: { target: "session:test" },
  profilePath: "desk.json",
  plan: {
    reading: {
      at: address(documentId),
      version: "v1",
      observedAt: "2026-08-25T00:00:00Z",
    },
    planHash: "hash-1",
    entries: [emptyEntry],
  },
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
    sessions: async () =>
      ["test", "new"].map((id, index) => ({
        sessionId: `bridge-${id}`,
        sdkSessionId: id,
        processId: 40 + index,
        lane: "dev" as const,
        custody: "controlled" as const,
        activeDocumentId: `C:\\Models\\${id === "test" ? "Test" : "New"}.rvt`,
        activeDocumentTitle: `${id === "test" ? "Test" : "New"}.rvt`,
        openDocumentCount: 1,
      })),
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
const make = (
  testFixture = fixture(),
  search: { target: string; patch(partial: { target?: string }): void } = {
    target: "session:test",
    patch() {},
  },
  routeDocument = document(),
) => {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  const docSlice = Atom.make(AsyncResult.success(slice(routeDocument)));
  return {
    registry,
    calls: testFixture.calls,
    docSlice,
    store: createFamiliesStore({
      registry,
      scope: { threadId: "thread-1" },
      host: testFixture.host,
      search,
      slice: docSlice,
    }),
  };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("families route store", () => {
  it("unbinds a persisted plan from another document", () => {
    const { registry, store } = make(fixture(), undefined, document("C:\\Models\\Other.rvt"));

    expect(registry.get(store.atoms.plan)).toBeNull();
  });

  it("keeps a persisted plan from the bound document", async () => {
    const { registry, store } = make();
    await tick();

    expect(registry.get(store.atoms.plan)?.reading).toMatchObject({
      at: "C:\\Models\\Test.rvt",
      version: "v1",
    });
  });

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
    expect(calls).toEqual([{ op: "apply", input: [{ path: ["excludedIds"], value: [1] }] }]);
  });

  it("binds another target without clearing the plan", async () => {
    const { calls, registry, store } = make(fixture(), {
      target: "session:new",
      patch() {},
    });
    await tick();
    expect(registry.get(store.atoms.failure)).toBeNull();
    expect(calls.filter(({ op }) => op === "apply")).toEqual([
      {
        op: "apply",
        input: [
          { path: ["binding"], value: expect.objectContaining({ target: "session:new" }) },
        ],
      },
    ]);
  });

  it("rebinds a direct URL target before plan", async () => {
    const { calls, store } = make(fixture(), {
      target: "session:new",
      patch() {},
    });
    await tick();
    store.actions.setDraft({
      placement: "AllLoaded",
      categories: ["Furniture"],
      families: ["Desk"],
    });
    await store.actions.applyScope();
    await store.actions.plan();
    expect(calls.filter(({ op }) => op === "apply" || op === "plan")).toEqual([
      { op: "apply", input: expect.any(Array) },
      { op: "apply", input: expect.any(Array) },
      { op: "plan", input: expect.any(Object) },
    ]);
  });
});
