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
  expectRouteWrite,
  type Scope,
  type Slice,
  verbFailure,
  worldSelector,
} from "#/state/route-store";
import type { BindingPatch } from "#/targeting/kit";
import type { HostOperationCatalogEntry } from "#/ops/product";

type Mode = "form" | "raw";
type Setter<A> = A | ((previous: A) => A);
type PickerState = { open: string | null; level: string | null; query: string };
type Identity = { target: string };
type OpsSlice = Atom.Atom<AsyncResult.AsyncResult<Slice<OpsRouteDocument>, Error>>;

export function createOpsStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  slice?: OpsSlice;
  apply?: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  call?: typeof callHostDynamic;
  now?: () => Date;
  initial?: {
    op: string;
    identity: Identity;
    request?: { args: string; mode: Mode; formValues: Record<string, unknown> };
  };
}) {
  const core = createRouteStoreCore("ops", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const slice = owned("slice/ops", deps.slice ?? docAtom(opsRouteState, deps.scope));
  const writer = docWriter(opsRouteState, deps.scope, deps.registry, slice);
  const apply = deps.apply ?? writer.apply;
  const call = deps.call ?? callHostDynamic;
  const now = deps.now ?? (() => new Date());
  const document = Atom.make((get): OpsRouteDocument | null => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  // ponytail: the world is the page Scope's session; changing it is a `?target` navigation, not a doc write.
  const world = Atom.make(() => worldSelector(deps.scope.scope)).pipe(owned("binding/world"));
  const hydrated = Atom.make((get) => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) && result.value.hydrated;
  }).pipe(owned("view/hydrated"));
  const identity = Atom.make<Identity | null>(deps.initial?.identity ?? null).pipe(
    owned("page/identity"),
  );
  const selectedKey = Atom.make(deps.initial?.op ?? "").pipe(owned("page/op"));
  const draftKey = Atom.make(deps.initial?.request ? (deps.initial?.op ?? "") : "").pipe(
    owned("page/draft-op"),
  );
  const localResult = Atom.make<OpsReceipt | null>(null).pipe(owned("page/result"));
  const result = Atom.make((get) => {
    const value = get(localResult) ?? get(document)?.receipt ?? null;
    const current = get(identity);
    return value && current && value.opKey === get(selectedKey) && value.target === current.target
      ? value
      : null;
  }).pipe(owned("view/result"));
  const args = Atom.make(deps.initial?.request?.args ?? "{}").pipe(owned("page/request"));
  const mode = Atom.make<Mode>(deps.initial?.request?.mode ?? "raw").pipe(owned("page/mode"));
  const formValues = Atom.make<Record<string, unknown>>(
    deps.initial?.request?.formValues ?? {},
  ).pipe(owned("page/form-values"));
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
  const persistBinding = async (
    verb: string,
    _world: string,
    op: string,
    current: Identity | null,
  ) => {
    try {
      registry.set(identity, current);
      registry.set(selectedKey, op);
      registry.set(localResult, null);
      const routeSlice = registry.get(slice);
      if (!AsyncResult.isSuccess(routeSlice) || !routeSlice.value.hydrated) return;
      const doc = registry.get(document);
      const patches: RouteStatePatch[] = [];
      if (doc?.bindings.op?.id !== (op || null))
        patches.push({
          path: ["bindings", "op"],
          value: op ? { id: op, label: op } : undefined,
        });
      if (patches.length) expectRouteWrite(await apply(patches));
    } catch (cause) {
      write(verb, "failure", () => registry.set(core.failure, verbFailure(verb, cause)));
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
    setBindings(patch: BindingPatch<"world" | "op">, current: Identity | null) {
      const nextWorld = patch.bound?.world ?? registry.get(world);
      const op = patch.bound?.op ?? registry.get(selectedKey);
      return persistBinding("set-bindings", nextWorld || "", op || "", current);
    },
    run(input: { opKey: string; request: () => unknown; target: string; bridgeSessionId: string }) {
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
          target: input.target,
          observedAt: now().toISOString(),
        };
        expectRouteWrite(await apply([{ path: ["receipt"], value: receipt }]));
        registry.set(localResult, receipt);
        return `${input.opKey} · ${receipt.elapsedMs}ms`;
      });
    },
  };

  return {
    registry,
    scope: deps.scope,
    atoms: {
      world,
      op: selectedKey,
      args,
      mode,
      formValues,
      picker,
      selectedGlance,
      hydrated,
      result,
      ...core.verbAtoms,
    },
    actions,
    dispose() {
      core.dispose();
    },
  };
}

export type OpsStore = ReturnType<typeof createOpsStore>;
