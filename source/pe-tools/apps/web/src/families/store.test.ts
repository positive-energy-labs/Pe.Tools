import { afterEach, describe, expect, it } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  type FamiliesRouteDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

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
  bindings: { world: { id: "session:test", label: "test", at: address("C:\\Models\\Test.rvt") } },
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
  revision: 0,
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
    project: async () => ({ projections: [], diagnostics: [] }),
    openPath: async () => ({}),
  };
  const writer = {
    apply: (patches: RouteStatePatch[]) => ok("apply", patches),
    command: (name: "plan" | "apply", input?: unknown) => ok(name, input ?? {}),
  };
  return { host, writer, calls };
};
const make = (
  testFixture = fixture(),
  _search: { target: string; patch(partial: { target?: string }): void } = {
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
      scope: { documentAddress: address("C:\\Models\\Test.rvt") },
      host: testFixture.host,
      slice: docSlice,
      writer: testFixture.writer,
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
    testFixture.writer.command = (name, input) =>
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
    const { calls, registry, store } = make();
    await store.actions.bind("session:new");
    expect(registry.get(store.atoms.failure)).toBeNull();
    expect(calls.filter(({ op }) => op === "apply")).toEqual([
      {
        op: "apply",
        input: [
          {
            path: ["bindings", "world"],
            value: expect.objectContaining({ id: "session:new" }),
          },
        ],
      },
    ]);
  });

  it("reloads a persisted document binding before plan", async () => {
    const persisted = document();
    persisted.bindings.world = {
      id: "session:new",
      label: "new",
      at: address("C:\\Models\\Test.rvt"),
    };
    const { calls, registry, store } = make(fixture(), undefined, persisted);
    expect(registry.get(store.atoms.target)).toBe("session:new");
    store.actions.setDraft({
      placement: "AllLoaded",
      categories: ["Furniture"],
      families: ["Desk"],
    });
    await store.actions.applyScope();
    await store.actions.plan();
    expect(calls.filter(({ op }) => op === "apply" || op === "plan")).toEqual([
      { op: "plan", input: expect.any(Object) },
    ]);
  });
});
