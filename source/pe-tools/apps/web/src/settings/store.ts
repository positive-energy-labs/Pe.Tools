import { Effect, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  settingsFieldSegments,
  type RouteStatePatch,
  type SettingsFieldState,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import { SettingsFileKind, type SettingsFileEntry } from "@pe/host-contracts/operation-types";

import { mintSelector, sessionLabel } from "#/host/target";
import {
  createRouteStoreCore,
  feed,
  hostRead,
  unbound,
  type Lane,
  type Scope,
} from "#/state/route-store";
import type { SettingsHost } from "#/settings/host";

export interface SettingsSearchPort {
  readonly source?: "fixture";
  patch(partial: { source?: "fixture" }): void;
}

export interface SettingsPicker {
  workspaceKey: string | undefined;
  moduleKey: string | undefined;
  rootKey: string | undefined;
  filePath: string | undefined;
}

type HeadPicker = { open: string | null; level: string | null; query: string };
type Setter<A> = A | ((previous: A) => A);
type PendingStage = {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (cause: unknown) => void;
};

function authoringFile(entry: SettingsFileEntry) {
  return (
    entry.kind !== SettingsFileKind.Fragment &&
    entry.kind !== SettingsFileKind.Schema &&
    !entry.isFragment &&
    !entry.isSchema &&
    entry.relativePath.toLowerCase().endsWith(".json")
  );
}

function stagedValues(snapshot: SettingsRouteDocument["snapshot"], fields: Record<string, SettingsFieldState>) {
  if (!snapshot) return {};
  let values: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(snapshot.rawContent);
    values = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? structuredClone(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
  for (const [pointer, field] of Object.entries(fields)) {
    if (field.staged == null) continue;
    const segments = settingsFieldSegments(pointer);
    let cursor = values;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      if (next == null || typeof next !== "object" || Array.isArray(next)) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = segments.at(-1);
    if (leaf === undefined) continue;
    if (field.staged.delete === true) delete cursor[leaf];
    else cursor[leaf] = field.staged.value;
  }
  return values;
}

export function createSettingsStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  host: SettingsHost;
  search: SettingsSearchPort;
}) {
  const core = createRouteStoreCore("settings", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);
  const lane: Lane = deps.search.source === "fixture" ? "fixture" : "read";

  const settingsSlice = owned("slice/settings", deps.host.document(deps.scope));
  const document = Atom.make((get): SettingsRouteDocument | null => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const snapshot = Atom.make((get) => get(document)?.snapshot ?? null).pipe(owned("view/snapshot"));
  const fields = Atom.make((get) => get(document)?.fields ?? {}).pipe(owned("view/fields"));
  const validation = Atom.make((get) => get(snapshot)?.validation ?? null).pipe(owned("view/validation"));
  const binding = Atom.make((get) => get(document)?.binding ?? { target: null }).pipe(owned("view/binding"));
  const proposals = Atom.make((get) =>
    Object.entries(get(fields)).filter(([, field]) => field.proposal != null),
  ).pipe(owned("view/proposals"));
  const formDirty = Atom.make((get) => Object.values(get(fields)).some((field) => field.staged != null)).pipe(owned("view/form-dirty"));
  const formValues = Atom.make((get) => stagedValues(get(snapshot), get(fields))).pipe(owned("view/form-values"));
  const connected = Atom.make((get) => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.connected : null;
  }).pipe(owned("view/connected"));
  const peaActive = Atom.make((get) => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) && result.value.peaActive;
  }).pipe(owned("view/pea-active"));
  const sliceError = Atom.make((get) => {
    const result = get(settingsSlice);
    return AsyncResult.isFailure(result)
      ? String(result.cause)
      : AsyncResult.isSuccess(result)
        ? result.value.error
        : null;
  }).pipe(owned("view/slice-error"));

  const picker = Atom.make<SettingsPicker>({
    workspaceKey: undefined,
    moduleKey: undefined,
    rootKey: undefined,
    filePath: undefined,
  }).pipe(owned("page/picker"));
  const targeting = Atom.make<HeadPicker>({ open: null, level: null, query: "" }).pipe(owned("page/targeting"));

  const workspacesSource = runtime.atom(() => hostRead(["settings.workspaces"], deps.host.workspaces));
  const workspacesResult = runtimeFactory.withReactivity(["settings.workspaces"])(
    Atom.swr(workspacesSource, { staleTime: "5 minutes", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);
  const modulesSource = runtime.atom((get) => {
    const workspaceKey = get(picker).workspaceKey;
    return workspaceKey
      ? hostRead(["settings.workspaces", workspaceKey], async () =>
          (await deps.host.workspaces()).find((item) => item.workspaceKey === workspaceKey)?.modules ?? [],
        )
      : Effect.succeed(unbound([], ["workspace"]));
  });
  const modulesResult = runtimeFactory.withReactivity(["settings.workspaces"])(
    Atom.swr(modulesSource, { staleTime: "5 minutes", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);
  const rootsSource = runtime.atom((get) => {
    const selected = get(picker);
    return selected.workspaceKey && selected.moduleKey
      ? hostRead(["settings.workspaces", selected.workspaceKey, selected.moduleKey], async () =>
          (await deps.host.workspaces())
            .find((item) => item.workspaceKey === selected.workspaceKey)
            ?.modules.find((item) => item.moduleKey === selected.moduleKey)?.roots ?? [],
        )
      : Effect.succeed(unbound([], ["workspace", "module"]));
  });
  const rootsResult = runtimeFactory.withReactivity(["settings.workspaces"])(
    Atom.swr(rootsSource, { staleTime: "5 minutes", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);
  const treeSource = runtime.atom((get) => {
    const { moduleKey, rootKey } = get(picker);
    return moduleKey && rootKey
      ? hostRead([moduleKey, rootKey], () => deps.host.tree(moduleKey, rootKey))
      : Effect.succeed(unbound<SettingsFileEntry[]>([], ["module", "root"]));
  });
  const treeResult = runtimeFactory.withReactivity(["settings.tree"])(
    Atom.swr(treeSource, { staleTime: "60 seconds", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);
  const schemaSource = runtime.atom((get) => {
    const open = get(snapshot)?.documentId;
    const pick = get(picker);
    const moduleKey = open?.moduleKey ?? pick.moduleKey;
    const rootKey = open?.rootKey ?? pick.rootKey;
    return moduleKey && rootKey
      ? hostRead([moduleKey, rootKey], () => deps.host.schema(moduleKey, rootKey))
      : Effect.succeed(unbound("", ["module", "root"]));
  });
  const schemaResult = runtimeFactory.withReactivity(["settings.schema"])(
    Atom.swr(schemaSource, { staleTime: "5 minutes", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);
  const sessionsSource = runtime.atom(() => hostRead(["bridge.sessions.list"], deps.host.sessions));
  const sessionsResult = runtimeFactory.withReactivity(["sessions"])(
    Atom.swr(sessionsSource, { staleTime: "5 seconds", revalidateOnMount: false }),
  ).pipe(Atom.autoDispose);

  const workspaceFeed = Atom.make((get) =>
    feed(get(workspacesResult), (items) => items.map((item) => ({ id: item.workspaceKey, label: item.displayName || item.workspaceKey })), lane),
  ).pipe(owned("feed/workspace"));
  const moduleFeed = Atom.make((get) =>
    feed(get(modulesResult), (items) => items.map((item) => ({ id: item.moduleKey, label: item.moduleKey })), lane, { needs: "a workspace" }),
  ).pipe(owned("feed/module"));
  const rootFeed = Atom.make((get) =>
    feed(get(rootsResult), (items) => items.map((item) => ({ id: item.rootKey, label: item.displayName || item.rootKey })), lane, { needs: "a module" }),
  ).pipe(owned("feed/root"));
  const fileFeed = Atom.make((get) =>
    feed(get(treeResult), (items) => items.filter(authoringFile).map((item) => ({ id: item.relativePath, label: item.relativePath })), lane, { needs: "a module and root" }),
  ).pipe(owned("feed/file"));
  const sessionFeed = Atom.make((get) =>
    feed(get(sessionsResult), (items) => items.map((item) => ({ id: mintSelector(item, items), label: sessionLabel(item) })), lane),
  ).pipe(owned("feed/session"));
  const schemaJson = Atom.make((get) => {
    const result = get(schemaResult);
    return AsyncResult.isSuccess(result) && result.value.bound ? result.value.value : undefined;
  }).pipe(owned("view/schema-json"));

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    write(verb, atom.label?.[0] ?? "page", () =>
      registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const expect = <T extends { ok: boolean; error?: string; hint?: string }>(result: T, fallback: string) => {
    if (!result.ok) throw Error(result.hint ?? result.error ?? fallback);
    return result;
  };
  const pending = new Map<string, PendingStage>();
  const stage = (name: string, value: unknown) => {
    const prior = pending.get(name);
    if (prior) {
      clearTimeout(prior.timer);
      prior.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(async () => {
        pending.delete(name);
        try {
          const patch: RouteStatePatch = { path: ["fields", name, "staged"], value: { value } };
          expect(await deps.host.apply([patch]), `staging ${name} failed`);
          resolve();
        } catch (cause) {
          reject(cause);
        }
      }, 150);
      pending.set(name, { timer, resolve, reject });
    });
  };

  const actions = {
    setPicker: (value: Setter<SettingsPicker>) => set("pick", picker, value),
    setTargeting: (value: Setter<HeadPicker>) => set("targeting", targeting, value),
    stage: (name: string, value: unknown) => write("stage", name, () => stage(name, value)),
    apply: (patches: RouteStatePatch[]) => write("apply", "slice/fields", async () =>
      expect(await deps.host.apply(patches), "field update failed"),
    ),
    open: () => runVerb("open", async () => {
      const { moduleKey, rootKey, filePath } = registry.get(picker);
      if (!moduleKey || !rootKey || !filePath) throw Error("open needs a module, root, and file");
      expect(await deps.host.command("open", { documentId: { moduleKey, rootKey, relativePath: filePath } }), "open failed");
      return `opened ${filePath}`;
    }, ["settings", "settings.schema"]),
    refresh: () => runVerb("refresh", async () => {
      expect(await deps.host.command("refresh"), "re-read failed");
      return "re-read settings";
    }, ["settings", "settings.schema"]),
    validate: () => runVerb("validate", async () => {
      expect(await deps.host.command("validate", { includeProposals: false }), "validate failed");
      return "validated settings";
    }, ["settings"]),
    save: () => runVerb("save", async () => {
      expect(await deps.host.command("save"), "save failed");
      return "saved settings";
    }, ["settings"]),
    bind: (target: string | null) => runVerb("bind", async () => {
      expect(await deps.host.command("bind", { target }), "bind failed");
      return target ? `bound ${target}` : "unbound session";
    }, ["settings"]),
  };

  return {
    registry,
    search: deps.search,
    slices: { settings: settingsSlice },
    atoms: {
      snapshot,
      fields,
      validation,
      binding,
      proposals,
      formDirty,
      formValues,
      schemaJson,
      connected,
      peaActive,
      sliceError,
      picker,
      targeting,
      busy: core.busy,
      failure: core.failure,
      receipt: core.receipt,
    },
    feeds: {
      workspace: workspaceFeed,
      module: moduleFeed,
      root: rootFeed,
      file: fileFeed,
      session: sessionFeed,
    },
    actions,
    dispose() {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.resolve();
      }
      pending.clear();
      core.dispose();
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
