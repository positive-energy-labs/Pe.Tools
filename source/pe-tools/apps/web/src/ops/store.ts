import { z } from "zod";
import { readAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { OpsReceipt } from "@pe/agent-contracts";

import { HostRpcCaller } from "../../../../packages/mcps/src/shared/host-rpc-caller";
import { callHostDynamic } from "#/host/client";
import { createRouteOwner } from "#/route";
import type { HostOperationCatalogEntry } from "#/ops/manifest";

/** What a page write to the two bound names looks like. Was `targeting/model`'s BindingPatch. */
type BindingPatch<K extends string> = { bound?: Partial<Record<K, string | null>> };

type Mode = "form" | "raw";
type Setter<A> = A | ((previous: A) => A);
type PickerState = { open: string | null; level: string | null; query: string };
type Identity = { target: string };
export const opsPageSeedSchema = z.object({
  op: z.string().default(""),
  target: z.string().default(""),
  openDocumentId: z.string().default(""),
  actionId: z.string().nullable().default(null),
  request: z
    .object({
      args: z.string(),
      mode: z.enum(["form", "raw"]),
      formValues: z.record(z.string(), z.unknown()),
    })
    .optional(),
  picker: z
    .object({ open: z.string().nullable(), level: z.string().nullable(), query: z.string() })
    .optional(),
  glance: z.string().nullable().optional(),
});
export type OpsPageSeed = z.infer<typeof opsPageSeedSchema>;

export function createOpsStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  hostBaseUrl?: string;
  onSeed?: (seed: OpsPageSeed) => void;
  receipt?: OpsReceipt;
  call?: typeof callHostDynamic;
  now?: () => Date;
  initial?: Partial<OpsPageSeed>;
}) {
  const core = createRouteOwner("ops", deps.registry);
  const { registry, owned, write, runAction } = core;
  const initial = opsPageSeedSchema.parse(deps.initial ?? {});
  const actionId = Atom.make<string | null>(initial.actionId).pipe(owned("page/action-id"));
  const now = deps.now ?? (() => new Date());
  const world = Atom.make(initial.target).pipe(owned("page/target"));
  const openDocumentId = Atom.make(initial.openDocumentId).pipe(owned("page/open-document-id"));
  const identity = Atom.make<Identity | null>(null).pipe(owned("page/identity"));
  const selectedKey = Atom.make(deps.initial?.op ?? "").pipe(owned("page/op"));
  const draftKey = Atom.make(deps.initial?.request ? (deps.initial?.op ?? "") : "").pipe(
    owned("page/draft-op"),
  );
  const localResult = Atom.make<OpsReceipt | null>(deps.receipt ?? null).pipe(owned("page/result"));
  const result = Atom.make((get) => {
    const value = get(localResult);
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
  const picker = Atom.make<PickerState>(
    initial.picker ?? { open: null, level: null, query: "" },
  ).pipe(owned("page/picker"));
  const selectedGlance = Atom.make<string | null>(initial.glance ?? null).pipe(
    owned("page/glance"),
  );

  const seed = (): OpsPageSeed => ({
    op: registry.get(selectedKey),
    target: registry.get(world),
    openDocumentId: registry.get(openDocumentId),
    actionId: registry.get(actionId),
    request: {
      args: registry.get(args),
      mode: registry.get(mode),
      formValues: registry.get(formValues),
    },
    picker: registry.get(picker),
    glance: registry.get(selectedGlance),
  });
  const publish = () => deps.onSeed?.(seed());
  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) => {
    write(verb, atom.label?.[0] ?? "page", () =>
      registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
    publish();
  };
  const persistBinding = async (
    _verb: string,
    _world: string,
    op: string,
    current: Identity | null,
  ) => {
    registry.set(identity, current);
    registry.set(selectedKey, op);
    publish();
  };

  const actions = {
    setOpenDocumentId: (value: string) => set("document", openDocumentId, value),
    setArgs: (value: Setter<string>) => set("draft", args, value),
    setMode: (value: Setter<Mode>) => set("mode", mode, value),
    setFormValues: (value: Setter<Record<string, unknown>>) =>
      set("form-values", formValues, value),
    setPicker: (value: Setter<PickerState>) => set("picker", picker, value),
    setSelectedGlance: (value: string | null) => set("glance", selectedGlance, value),
    select(operation: HostOperationCatalogEntry | undefined, seed: Record<string, unknown>) {
      if (!operation) return; // A disappearing catalogue cannot replace the caller's draft.
      const key = operation.key;
      if (registry.get(draftKey) === key) return;
      Atom.batch(() => {
        registry.set(draftKey, key);
        registry.set(
          args,
          operation?.requestExamples?.[0]?.json ?? operation?.safeDefaultRequestJson ?? "{}",
        );
        registry.set(formValues, seed);
        registry.set(mode, operation?.requestSchemaJson ? "form" : "raw");
        registry.set(localResult, null);
        registry.set(selectedGlance, null);
      });
      publish();
    },
    async syncBindings(world: string, op: string, current: Identity | null) {
      await persistBinding("sync-bindings", world, op, current);
    },
    setBindings(patch: BindingPatch<"world" | "op">, current: Identity | null) {
      const nextWorld = patch.bound?.world ?? registry.get(world);
      const op = patch.bound?.op ?? registry.get(selectedKey);
      if (nextWorld !== registry.get(world)) {
        registry.set(world, nextWorld || "");
        registry.set(openDocumentId, "");
      }
      return persistBinding("set-bindings", nextWorld || "", op || "", current);
    },
    run(input: {
      opKey: string;
      request: () => unknown;
      target: string;
      bridgeSessionId?: string;
      openDocumentId?: string;
    }) {
      return runAction("run", async () => {
        registry.set(localResult, null);
        const request = input.request();
        const started = performance.now();
        const base = deps.hostBaseUrl ?? window.location.origin;
        const id = crypto.randomUUID();
        const response = deps.call
          ? undefined
          : await new HostRpcCaller({
              hostBaseUrl: base,
              actor: "human",
              requestId: id,
              beforeAdmission: async (id) => {
                const previousId = registry.get(actionId);
                if (previousId) {
                  const prior = await readAction(previousId, base);
                  if (!prior || (prior.state !== "succeeded" && prior.state !== "failed"))
                    throw Error(
                      "Read or reconcile the original action before starting another operation",
                    );
                }
                registry.set(actionId, id);
                publish();
              },
              bridgeSessionId: input.bridgeSessionId,
              openDocumentId: input.openDocumentId,
            }).callOperation(input.opKey, request);
        if (response && !response.ok) throw Error(response.message);
        const value = response?.ok
          ? response.response
          : await deps.call!(input.opKey, request, {
              bridgeSessionId: input.bridgeSessionId,
              openDocumentId: input.openDocumentId,
            });
        const receipt: OpsReceipt = {
          opKey: input.opKey,
          request,
          value,
          elapsedMs: Math.round(performance.now() - started),
          target: input.target,
          observedAt: now().toISOString(),
        };
        registry.set(localResult, receipt);
        return null;
      });
    },
  };

  return {
    registry,
    atoms: {
      world,
      op: selectedKey,
      args,
      mode,
      formValues,
      picker,
      selectedGlance,
      openDocumentId,
      result,
      actionId,
    },
    actions,
    seed,
    dispose() {
      core.dispose();
    },
  };
}

export type OpsStore = ReturnType<typeof createOpsStore>;
