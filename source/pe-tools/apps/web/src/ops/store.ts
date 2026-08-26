import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  opsRouteState,
  type OpsReceipt,
  type OpsRouteDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

import { callHostDynamic } from "#/host/client";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  type Scope,
  type Slice,
} from "#/state/route-store";
import type { BindingState } from "#/targeting/kit";
import type { HostOperationCatalogEntry } from "#/ops/product";

type Mode = "form" | "raw";
type Setter<A> = A | ((previous: A) => A);
type PickerState = { open: string | null; level: string | null; query: string };
type Identity = { target: string; documentId?: string };
type OpsSlice = Atom.Atom<AsyncResult.AsyncResult<Slice<OpsRouteDocument>, Error>>;

interface OpsSearchPort {
  world: string;
  op: string;
  patch(partial: { world?: string; op?: string }): void;
}

const opsReadingIsCurrent = (from: OpsReceipt["from"], current: Identity) =>
  from.target === current.target &&
  (from.documentId === undefined || from.documentId === current.documentId);

export function createOpsStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  search: OpsSearchPort;
  slice?: OpsSlice;
  apply?: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  call?: typeof callHostDynamic;
  now?: () => Date;
}) {
  const core = createRouteStoreCore("ops", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const writer = docWriter(opsRouteState, deps.scope);
  const apply = deps.apply ?? writer.apply;
  const call = deps.call ?? callHostDynamic;
  const now = deps.now ?? (() => new Date());
  const slice = owned("slice/ops", deps.slice ?? docAtom(opsRouteState, deps.scope));
  const document = Atom.make((get): OpsRouteDocument | null => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const hydrated = Atom.make((get) => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) && result.value.hydrated;
  }).pipe(owned("view/hydrated"));
  const identity = Atom.make<Identity | null>(null).pipe(owned("page/identity"));
  const selectedKey = Atom.make("").pipe(owned("page/op"));
  const draftKey = Atom.make("").pipe(owned("page/draft-op"));
  const localResult = Atom.make<OpsReceipt | null>(null).pipe(owned("page/result"));
  const result = Atom.make((get) => {
    const value = get(localResult) ?? get(document)?.receipt ?? null;
    const current = get(identity);
    return value &&
      current &&
      value.opKey === get(selectedKey) &&
      opsReadingIsCurrent(value.from, current)
      ? value
      : null;
  }).pipe(owned("view/result"));
  const args = Atom.make("{}").pipe(owned("page/request"));
  const mode = Atom.make<Mode>("raw").pipe(owned("page/mode"));
  const formValues = Atom.make<Record<string, unknown>>({}).pipe(owned("page/form-values"));
  const picker = Atom.make<PickerState>({ open: null, level: null, query: "" }).pipe(
    owned("page/picker"),
  );
  const selectedGlance = Atom.make<string | null>(null).pipe(owned("page/glance"));

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    write(verb, atom.label?.[0] ?? "page", () =>
      registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const expectOk = (value: RouteStateWriteResult) => {
    if (!value.ok) throw Error(value.hint ?? value.error ?? "route document write failed");
    return value;
  };
  const clearForBinding = async (world: string, op: string, current: Identity | null) => {
    registry.set(identity, current);
    registry.set(selectedKey, op);
    registry.set(localResult, null);
    const routeSlice = registry.get(slice);
    if (!AsyncResult.isSuccess(routeSlice) || !routeSlice.value.hydrated) return;
    const doc = registry.get(document);
    const patches: RouteStatePatch[] = [];
    if (doc?.binding.target !== (world || null))
      patches.push({
        path: ["binding"],
        value: { target: world || null, boundAt: world ? now().toISOString() : null },
      });
    if (
      doc?.receipt &&
      (!current || doc.receipt.opKey !== op || !opsReadingIsCurrent(doc.receipt.from, current))
    )
      patches.push({ path: ["receipt"], value: null });
    if (patches.length) expectOk(await apply(patches));
  };
  const persistBinding = async (
    verb: string,
    world: string,
    op: string,
    current: Identity | null,
  ) => {
    try {
      await clearForBinding(world, op, current);
    } catch (cause) {
      write(verb, "failure", () =>
        registry.set(core.failure, {
          kind: "host",
          verb,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  };

  const actions = {
    setArgs: (value: Setter<string>) => set("draft", args, value),
    setMode: (value: Setter<Mode>) => set("mode", mode, value),
    setFormValues: (value: Setter<Record<string, unknown>>) =>
      set("form-values", formValues, value),
    setPicker: (value: Setter<PickerState>) => set("picker", picker, value),
    setSelectedGlance: (value: string | null) => set("glance", selectedGlance, value),
    select(operation: HostOperationCatalogEntry | undefined, seed: Record<string, unknown>) {
      const key = operation?.key ?? "";
      if (registry.get(draftKey) === key) return;
      Atom.batch(() => {
        registry.set(draftKey, key);
        registry.set(
          args,
          operation?.requestExamples[0]?.json ?? operation?.safeDefaultRequestJson ?? "{}",
        );
        registry.set(formValues, seed);
        registry.set(mode, operation?.requestSchemaJson ? "form" : "raw");
        registry.set(localResult, null);
        registry.set(selectedGlance, null);
      });
    },
    async syncBindings(world: string, op: string, current: Identity | null) {
      await persistBinding("sync-bindings", world, op, current);
    },
    setBindings(patch: Partial<BindingState>, current: Identity | null) {
      const world = patch.bound?.world ?? deps.search.world;
      const op = patch.bound?.op ?? deps.search.op;
      deps.search.patch({ world: world || "", op: op || "" });
      return persistBinding("set-bindings", world || "", op || "", current);
    },
    run(input: { opKey: string; request: () => unknown; from: Identity; bridgeSessionId: string }) {
      return runVerb("run", async () => {
        registry.set(localResult, null);
        const request = input.request();
        const started = performance.now();
        const value = await call(input.opKey, request, {
          bridgeSessionId: input.bridgeSessionId,
        });
        const receipt: OpsReceipt = {
          opKey: input.opKey,
          request,
          value,
          elapsedMs: Math.round(performance.now() - started),
          from: { ...input.from, observedAt: now().toISOString() },
        };
        expectOk(await apply([{ path: ["receipt"], value: receipt }]));
        registry.set(localResult, receipt);
        return `${input.opKey} · ${receipt.elapsedMs}ms`;
      });
    },
  };

  return {
    registry,
    atoms: {
      args,
      mode,
      formValues,
      picker,
      selectedGlance,
      hydrated,
      result,
      busy: core.busy,
      failure: core.failure,
    },
    actions,
    dispose() {
      core.dispose();
    },
  };
}

export type OpsStore = ReturnType<typeof createOpsStore>;
