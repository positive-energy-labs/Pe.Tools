import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  OpsReceipt,
  OpsRouteDocument,
  RouteStatePatch,
  RouteStateWriteResult,
} from "@pe/agent-contracts";

import { bindOpsVerb, opsRefusal, type HostOperationCatalogEntry } from "#/ops/product";
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
  from: {
    target: "old",
    documentId: "old.rvt",
    observedAt: "2026-08-25T00:00:00.000Z",
  },
};
const document = (target = "observed", receipt: OpsReceipt = oldReceipt): OpsRouteDocument => ({
  binding: { target },
  receipt,
});
const feeds: Feeds = {
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
    scope: { threadId: "ops-test" },
    search: { world: "observed", op: "revit.context.document-session", patch() {} },
    slice: Atom.make(
      AsyncResult.success({
        doc: routeDocument,
        hydrated: options.hydrated ?? true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    ),
    apply: async (patches) => {
      writes.push(patches);
      return options.applyResult ?? { ok: true };
    },
    call: calls,
    now: () => new Date("2026-08-25T01:02:03.000Z"),
  });
  return { registry, store, calls, writes };
}

function gatedRun(
  store: ReturnType<typeof createOpsStore>,
  selected: HostOperationCatalogEntry,
  activeDocumentId?: string,
) {
  const product = bindOpsVerb(
    () =>
      store.actions.run({
        opKey: selected.key,
        request: () => ({}),
        from: {
          target: "observed",
          ...(selected.needs !== "nothing" && activeDocumentId
            ? { documentId: activeDocumentId }
            : {}),
        },
        bridgeSessionId: "bridge-observed",
      }),
    () => opsRefusal(selected, "observed"),
  );
  const verb = product.stages[0]!.verbs[0]!;
  const why = refusal(
    product,
    verb,
    { world: "observed", op: selected.key },
    {},
    { ...feeds, op: { ...feeds.op!, options: [{ id: selected.key, label: selected.key }] } },
  );
  return { why, run: () => (why ? Promise.resolve() : verb.run!()) };
}

describe("ops route store", () => {
  it("refuses an observed mutation before HTTP", async () => {
    const { store, calls } = make();
    const gated = gatedRun(store, operation("mutate"));

    await gated.run();

    expect(gated.why).toBe("mutating operations require a controlled world");
    expect(calls).not.toHaveBeenCalled();
  });

  it("allows an observed read and persists its Reading", async () => {
    const { store, calls, writes } = make();
    const gated = gatedRun(store, operation("read"), "projectA.rvt");

    await gated.run();

    expect(gated.why).toBeNull();
    expect(calls).toHaveBeenCalledOnce();
    expect(writes.at(-1)?.[0]?.value).toMatchObject({
      opKey: "revit.context.document-session",
      from: { target: "observed", observedAt: "2026-08-25T01:02:03.000Z" },
    });
  });

  it("omits documentId when a document-required operation has no active document", async () => {
    const { store, calls, writes } = make();
    const gated = gatedRun(store, operation("read"));

    await gated.run();

    expect(calls).toHaveBeenCalledOnce();
    expect(writes.at(-1)?.[0]?.value).toMatchObject({
      opKey: "revit.context.document-session",
      from: { target: "observed", observedAt: "2026-08-25T01:02:03.000Z" },
    });
    expect(writes.at(-1)?.[0]?.value).not.toHaveProperty("from.documentId");
  });

  it("projects a mismatched persisted receipt as unbound", async () => {
    const { registry, store } = make();

    await store.actions.syncBindings("observed", oldReceipt.opKey, {
      target: "new",
      documentId: "new.rvt",
    });

    expect(registry.get(store.atoms.result)).toBeNull();
  });

  it("projects a matching persisted receipt as bound", async () => {
    const matching: OpsReceipt = {
      ...oldReceipt,
      from: { ...oldReceipt.from, target: "observed", documentId: "projectA.rvt" },
    };
    const { registry, store } = make(document("observed", matching));

    await store.actions.syncBindings("observed", matching.opKey, {
      target: "observed",
      documentId: "projectA.rvt",
    });

    expect(registry.get(store.atoms.result)).toEqual(matching);
  });

  it("keeps a non-document receipt current across documents in the same target", async () => {
    const nonDocument: OpsReceipt = {
      ...oldReceipt,
      from: { target: "observed", observedAt: oldReceipt.from.observedAt },
    };
    const { registry, store } = make(document("observed", nonDocument));

    await store.actions.syncBindings("observed", nonDocument.opKey, {
      target: "observed",
      documentId: "another.rvt",
    });

    expect(registry.get(store.atoms.result)).toEqual(nonDocument);
  });

  it("does not write bindings before the route document hydrates", async () => {
    const { store, writes } = make(document("persisted"), { hydrated: false });

    await store.actions.syncBindings("", oldReceipt.opKey, null);

    expect(writes).toEqual([]);
  });

  it("binds elsewhere and clears a stale receipt in one write", async () => {
    const { store, writes } = make();

    await store.actions.setBindings(
      { bound: { world: "session:new", op: oldReceipt.opKey } },
      { target: "new", documentId: "new.rvt" },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      {
        path: ["binding"],
        value: {
          target: "session:new",
          boundAt: "2026-08-25T01:02:03.000Z",
        },
      },
      { path: ["receipt"], value: null },
    ]);
  });

  it("routes binding write failures to the store failure atom", async () => {
    const { registry, store } = make(document(), {
      applyResult: { ok: false, error: "binding write failed" },
    });

    await expect(
      store.actions.setBindings(
        { bound: { world: "session:new", op: oldReceipt.opKey } },
        { target: "new", documentId: "new.rvt" },
      ),
    ).resolves.toBeUndefined();

    expect(registry.get(store.atoms.failure)).toMatchObject({
      kind: "host",
      verb: "set-bindings",
      message: "binding write failed",
    });
  });
});
