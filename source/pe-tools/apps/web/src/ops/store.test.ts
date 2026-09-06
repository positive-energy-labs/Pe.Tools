import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  address,
  type OpsReceipt,
  type OpsRouteDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

import {
  OPS_PRODUCT,
  opsRefusal,
  type HostOperationCatalogEntry,
  type OpsSlot,
} from "#/ops/product";
import { createOpsStore } from "#/ops/store";
import { refusal, type Feeds } from "#/targeting/model";

const operation = (intent: "read" | "mutate"): HostOperationCatalogEntry => ({
  key: intent === "read" ? "revit.context.document-session" : "revit.apply.schedule",
  displayName: intent,
  intent,
  costTier: "cheap",
  visibility: "public",
  needs: "document",
  description: intent,
  searchTerms: [],
  requestExamples: [],
  callGuidance: [],
  requestSchemaJson: "{}",
  responseSchemaJson: "{}",
});
const oldReceipt = {
  opKey: "revit.context.document-session",
  value: { title: "old" },
  elapsedMs: 1,
  target: "old",
  observedAt: "2026-08-25T00:00:00.000Z",
};
const document = (_target = "observed", receipt: OpsReceipt = oldReceipt): OpsRouteDocument => ({
  bindings: {},
  receipt,
});
const feeds: Feeds<OpsSlot> = {
  world: {
    options: [{ id: "observed", label: "observed" }],
    state: "ready",
    lane: "live",
    stale: false,
  },
  op: { options: [], state: "ready", lane: "live", stale: false },
};
const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.dispose()));

function make(
  routeDocument = document(),
  options: { hydrated?: boolean; applyResult?: RouteStateWriteResult } = {},
) {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  registries.push(registry);
  const calls = vi.fn(async () => ({ title: "project-a" }));
  const writes: RouteStatePatch[][] = [];
  const store = createOpsStore({
    registry,
    scope: { scope: { kind: "document" as const, document: address("C:\\Models\\Test.rvt") } },
    slice: Atom.make(
      AsyncResult.success({
        doc: routeDocument,
        revision: options.hydrated === false ? null : 0,
        hydrated: options.hydrated ?? true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    ),
    apply: async (patches) => {
      writes.push(patches);
      return options.applyResult ?? { ok: true, revision: 1 };
    },
    call: calls,
    now: () => new Date("2026-08-25T01:02:03.000Z"),
  });
  return { registry, store, calls, writes };
}

function gatedRun(store: ReturnType<typeof createOpsStore>, selected: HostOperationCatalogEntry) {
  const productFeeds: Feeds<OpsSlot> = {
    ...feeds,
    op: { ...feeds.op, options: [{ id: selected.key, label: selected.key }] },
  };
  const product = OPS_PRODUCT(productFeeds, {
    run: () =>
      store.actions.run({
        opKey: selected.key,
        request: () => ({}),
        target: "observed",
        bridgeSessionId: "bridge-observed",
      }),
    refuse: () => opsRefusal(selected, "observed"),
  });
  const verb = product.stages[0]!.verbs[0]!;
  const bound = { world: "observed", op: selected.key };
  const why = refusal(product, verb, bound, {});
  return { why, run: () => (why ? Promise.resolve() : verb.run(bound, productFeeds)) };
}

describe("ops route store", () => {
  it("refuses an observed mutation before HTTP", async () => {
    const { store, calls } = make();
    const gated = gatedRun(store, operation("mutate"));

    await gated.run();

    expect(gated.why).toBe("mutating operations require a controlled world");
    expect(calls).not.toHaveBeenCalled();
  });

  it("allows an observed read and persists its plain receipt", async () => {
    const { store, calls, writes } = make();
    const gated = gatedRun(store, operation("read"));

    await gated.run();

    expect(gated.why).toBeNull();
    expect(calls).toHaveBeenCalledOnce();
    expect(writes.at(-1)?.[0]?.value).toMatchObject({
      opKey: "revit.context.document-session",
      target: "observed",
      observedAt: "2026-08-25T01:02:03.000Z",
    });
  });

  it("projects a mismatched persisted receipt as unbound", async () => {
    const { registry, store } = make();

    await store.actions.syncBindings("observed", oldReceipt.opKey, {
      target: "new",
    });

    expect(registry.get(store.atoms.result)).toBeNull();
  });

  it("projects a matching persisted receipt as bound", async () => {
    const matching: OpsReceipt = {
      ...oldReceipt,
      target: "observed",
    };
    const { registry, store } = make(document("observed", matching));

    await store.actions.syncBindings("observed", matching.opKey, {
      target: "observed",
    });

    expect(registry.get(store.atoms.result)).toEqual(matching);
  });

  it("does not write bindings before the route document hydrates", async () => {
    const { store, writes } = make(document("persisted"), { hydrated: false });

    await store.actions.syncBindings("", oldReceipt.opKey, null);

    expect(writes).toEqual([]);
  });

  it("binds elsewhere without clearing the receipt", async () => {
    const { store, writes } = make();

    await store.actions.setBindings(
      { bound: { world: "session:new", op: oldReceipt.opKey } },
      { target: "new" },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      {
        path: ["bindings", "world"],
        value: {
          id: "session:new",
          label: "session:new",
          at: address("C:\\Models\\Test.rvt"),
        },
      },
      {
        path: ["bindings", "op"],
        value: {
          id: oldReceipt.opKey,
          label: oldReceipt.opKey,
          at: address("C:\\Models\\Test.rvt"),
        },
      },
    ]);
  });

  it("routes binding write failures to the store failure atom", async () => {
    const { registry, store } = make(document(), {
      applyResult: { ok: false, kind: "error", error: "binding write failed", hint: "" },
    });

    await expect(
      store.actions.setBindings(
        { bound: { world: "session:new", op: oldReceipt.opKey } },
        { target: "new" },
      ),
    ).resolves.toBeUndefined();

    expect(registry.get(store.atoms.failure)).toMatchObject({
      kind: "error",
      verb: "set-bindings",
      message: "binding write failed",
    });
  });

  it("keeps a stale-revision binding refusal typed as refused", async () => {
    const { registry, store } = make(document(), {
      applyResult: {
        ok: false,
        kind: "refused",
        code: "stale_revision",
        error: "the document moved",
        hint: "re-read it before writing again.",
      },
    });

    await store.actions.setBindings(
      { bound: { world: "session:new", op: oldReceipt.opKey } },
      { target: "new" },
    );

    expect(registry.get(store.atoms.failure)).toMatchObject({
      kind: "refused",
      verb: "set-bindings",
    });
  });
});
