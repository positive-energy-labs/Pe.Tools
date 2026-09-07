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
import { fixtureFamilyPlanEntry } from "#/families/fixture";
import { createFamiliesStore } from "#/families/store";

const document = (documentId = "C:\\Models\\Test.rvt"): FamiliesRouteDocument => ({
  bindings: {},
  profilePath: "desk.json",
  plan: {
    reading: {
      at: address(documentId),
      version: "v1",
      observedAt: "2026-08-25T00:00:00Z",
    },
    entries: [fixtureFamilyPlanEntry],
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
  outcomeUnknown: false,
});
const fixture = () => {
  const calls: Array<{ op: string; input: unknown }> = [];
  const ok = async (op: string, input: unknown): Promise<RouteStateWriteResult> => {
    calls.push({ op, input });
    return { ok: true, revision: 1 };
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
    project: async () => ({ families: [], diagnostics: [] }),
    openFamily: async (target, familyId) => {
      calls.push({ op: "openFamily", input: { target, familyId } });
      return { savedPath: "C:\\Scratch\\Selected.rfa" };
    },
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
      scope: {
        scope: {
          kind: "document" as const,
          document: address("C:\\Models\\Test.rvt"),
          pin: "test",
        },
      },
      host: testFixture.host,
      navigateTarget: async (target) => {
        testFixture.calls.push({ op: "navigate", input: target });
      },
      slice: Atom.make((get) => get(docSlice)),
      writer: testFixture.writer,
    }),
  };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("families route store", () => {
  it("refuses external Apply for unknown outcomes and empty plans without crossing the host", async () => {
    const { registry, docSlice, store, calls } = make();
    await tick();
    registry.set(docSlice, AsyncResult.success({ ...slice(document()), outcomeUnknown: true }));
    expect(registry.get(store.atoms.applyRefusal)).toContain("outcome is unknown");
    await expect(store.actions.applyFoundry()).rejects.toThrow("outcome is unknown");
    const empty = document();
    empty.plan!.entries = [{ ...fixtureFamilyPlanEntry, changes: [], runEffects: [] }];
    registry.set(docSlice, AsyncResult.success(slice(empty)));
    expect(registry.get(store.atoms.applyRefusal)).toContain("No included family");
    await expect(store.actions.applyFoundry()).rejects.toThrow("No included family");
    expect(calls).toEqual([]);
  });

  it("refreshes family choices when categories change without waiting for cache expiry", async () => {
    const testFixture = fixture();
    const reads: string[][] = [];
    testFixture.host.families = async (_target, draft) => {
      reads.push(draft.categories);
      return ["PE Box"];
    };
    const { registry, store } = make(testFixture);
    await tick();
    store.actions.setDraft({
      placement: "AllLoaded",
      categories: ["Electrical Equipment"],
      families: [],
    });
    await tick();
    await tick();
    expect(reads).toEqual([["Electrical Equipment"]]);
    expect(registry.get(store.feeds.family).options?.map((option) => option.id)).toEqual([
      "PE Box",
    ]);
  });

  it("retries catalog and profile reads when the connected world returns", async () => {
    const testFixture = fixture();
    let categories = 0;
    let profiles = 0;
    testFixture.host.categories = async () => {
      if (++categories === 1) throw new Error("disconnected");
      return ["Mechanical Equipment"];
    };
    testFixture.host.profiles = async () => {
      if (++profiles === 1) throw new Error("disconnected");
      return ["company.json"];
    };
    const { registry, store } = make(testFixture);
    await tick();
    store.actions.refreshReads();
    await tick();
    await tick();

    expect(registry.get(store.feeds.category).options?.[0]?.id).toBe("Mechanical Equipment");
    expect(registry.get(store.feeds.profile).options?.[0]?.id).toBe("company.json");
  });

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

  it("types an empty-scope refusal as refused, not error", async () => {
    const { registry, store } = make();
    store.actions.setDraft({ placement: "AllLoaded", categories: [], families: [] });

    await expect(store.actions.applyScope()).rejects.toThrow(
      "scope needs at least one category and family",
    );

    expect(registry.get(store.atoms.failure)).toMatchObject({
      kind: "refused",
      verb: "apply-scope",
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
        : Promise.resolve({ ok: true, revision: 1, result: input });
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
    release({ ok: true, revision: 1 });
    await planning;
  });

  it("emits one excludedIds patch", async () => {
    const { calls, store } = make();
    await store.actions.exclude(1);
    expect(calls).toEqual([{ op: "apply", input: [{ path: ["excludedIds"], value: [1] }] }]);
  });

  it("binding another target is a navigation, never a document write", async () => {
    const { calls, registry, store } = make();
    await store.actions.bind("new");
    expect(registry.get(store.atoms.failure)).toBeNull();
    expect(calls).toEqual([{ op: "navigate", input: "new" }]);
  });

  it("reloads a persisted document binding before plan", async () => {
    const persisted = document();
    const { calls, registry, store } = make(fixture(), undefined, persisted);
    expect(registry.get(store.atoms.target)).toBe("pin:test|doc:C:\\Models\\Test.rvt");
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

it("family row opens its exact id and returns the new document scope with the user's pin", async () => {
  const { store, calls } = make();
  expect(await store.actions.openFamily(731)).toEqual({
    doc: address("C:\\Scratch\\Selected.rfa"),
    target: "test",
    capture: true,
  });
  expect(calls.at(-1)).toEqual({
    op: "openFamily",
    input: { target: "pin:test|doc:" + address("C:\\Models\\Test.rvt"), familyId: 731 },
  });
  store.dispose();
});
