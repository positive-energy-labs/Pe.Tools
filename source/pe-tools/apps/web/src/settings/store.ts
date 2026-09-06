import { Effect, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  settingsRouteState,
  settingsFieldSegments,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsFieldState,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import type { SettingsFileEntry } from "@pe/host-contracts/operation-types";

import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  expectRouteWrite,
  verbFailure,
  feed,
  hostRead,
  unbound,
  type Lane,
  type Scope,
} from "#/state/route-store";
import type { SettingsHost } from "#/settings/host";

interface SettingsPicker {
  workspaceKey: string | undefined;
  moduleKey: string | undefined;
  rootKey: string | undefined;
  filePath: string | undefined;
}

type HeadPicker = { open: string | null; level: string | null; query: string };
type Setter<A> = A | ((previous: A) => A);
interface PendingStage {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (cause: unknown) => void;
  value: unknown;
}

export function projectStagedValues(
  rawContent: string,
  fields: Record<string, SettingsFieldState>,
) {
  let values: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawContent);
    values =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
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
  slice?: Atom.Atom<
    AsyncResult.AsyncResult<import("#/state/route-store").Slice<SettingsRouteDocument>, Error>
  >;
  apply?: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  command?: (
    name: "open" | "refresh" | "validate" | "save",
    input?: unknown,
  ) => Promise<RouteStateWriteResult>;
}) {
  const core = createRouteStoreCore("settings", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);
  const lane: Lane = "read";

  const settingsSlice = owned(
    "slice/settings",
    deps.slice ?? docAtom(settingsRouteState, deps.scope),
  );
  const liveWriter = docWriter(settingsRouteState, deps.scope, deps.registry, settingsSlice);
  const apply = deps.apply ?? liveWriter.apply;
  const command = deps.command ?? liveWriter.command;
  const document = Atom.make((get): SettingsRouteDocument | null => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const snapshotSource = runtime.atom((get) => {
    const documentId = get(document)?.documentId;
    return documentId
      ? hostRead([documentId.moduleKey, documentId.rootKey, documentId.relativePath], () =>
          deps.host.open(documentId),
        )
      : Effect.succeed(
          unbound<import("@pe/agent-contracts").SettingsSnapshot | null>(null, [
            "settings document",
          ]),
        );
  });
  const snapshotResult = runtimeFactory
    .withReactivity(["settings"])(
      Atom.swr(snapshotSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshot = Atom.make((get) => {
    const result = get(snapshotResult);
    return AsyncResult.isSuccess(result) && result.value.bound ? result.value.value : null;
  }).pipe(owned("view/snapshot"));
  const fields = Atom.make((get) => get(document)?.fields ?? {}).pipe(owned("view/fields"));
  const validation = Atom.make((get) => get(snapshot)?.validation ?? null).pipe(
    owned("view/validation"),
  );
  const binding = Atom.make((get) => ({
    target: get(document)?.bindings.file?.id ?? null,
  })).pipe(owned("view/binding"));
  const proposals = Atom.make((get) =>
    Object.entries(get(fields)).filter(([, field]) => field.proposal != null),
  ).pipe(owned("view/proposals"));
  const formDirty = Atom.make((get) =>
    Object.values(get(fields)).some((field) => field.staged != null),
  ).pipe(owned("view/form-dirty"));
  const formValues = Atom.make((get) =>
    projectStagedValues(get(snapshot)?.rawContent ?? "{}", get(fields)),
  ).pipe(owned("view/form-values"));
  const connected = Atom.make((get) => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.connected : null;
  }).pipe(owned("view/connected"));
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
  const targeting = Atom.make<HeadPicker>({ open: null, level: null, query: "" }).pipe(
    owned("page/targeting"),
  );

  const workspacesSource = runtime.atom(() =>
    hostRead(["settings.workspaces"], deps.host.workspaces),
  );
  const workspacesResult = runtimeFactory
    .withReactivity(["settings.workspaces"])(
      Atom.swr(workspacesSource, { staleTime: "5 minutes", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const treeSource = runtime.atom((get) => {
    const { moduleKey, rootKey } = get(picker);
    return moduleKey && rootKey
      ? hostRead([moduleKey, rootKey], () => deps.host.tree(moduleKey, rootKey))
      : Effect.succeed(unbound<SettingsFileEntry[]>([], ["module", "root"]));
  });
  const treeResult = runtimeFactory
    .withReactivity(["settings.tree"])(
      Atom.swr(treeSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const schemaSource = runtime.atom((get) => {
    const open = get(document)?.documentId;
    const pick = get(picker);
    const moduleKey = open?.moduleKey ?? pick.moduleKey;
    const rootKey = open?.rootKey ?? pick.rootKey;
    return moduleKey && rootKey
      ? hostRead([moduleKey, rootKey], () => deps.host.schema(moduleKey, rootKey))
      : Effect.succeed(unbound("", ["module", "root"]));
  });
  const schemaResult = runtimeFactory
    .withReactivity(["settings.schema"])(
      Atom.swr(schemaSource, { staleTime: "5 minutes", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const workspaceFeed = Atom.make((get) =>
    feed(
      get(workspacesResult),
      (items) =>
        items.map((item) => ({
          id: item.workspaceKey,
          label: item.displayName || item.workspaceKey,
        })),
      lane,
    ),
  ).pipe(owned("feed/workspace"));
  const moduleFeed = Atom.make((get) =>
    feed(
      get(workspacesResult),
      (items) =>
        items
          .find((item) => item.workspaceKey === get(picker).workspaceKey)
          ?.modules.map((item) => ({ id: item.moduleKey, label: item.moduleKey })) ?? [],
      lane,
      { needs: "a workspace" },
    ),
  ).pipe(owned("feed/module"));
  const rootFeed = Atom.make((get) =>
    feed(
      get(workspacesResult),
      (items) => {
        const selected = get(picker);
        return (
          items
            .find((item) => item.workspaceKey === selected.workspaceKey)
            ?.modules.find((item) => item.moduleKey === selected.moduleKey)
            ?.roots.map((item) => ({
              id: item.rootKey,
              label: item.displayName || item.rootKey,
            })) ?? []
        );
      },
      lane,
      { needs: "a module" },
    ),
  ).pipe(owned("feed/root"));
  const fileFeed = Atom.make((get) =>
    feed(
      get(treeResult),
      (items) =>
        items
          .filter((entry) => entry.relativePath.toLowerCase().endsWith(".json"))
          .map((item) => ({ id: item.path, label: item.relativePath })),
      lane,
      { needs: "a module and root" },
    ),
  ).pipe(owned("feed/file"));
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
  const pending = new Map<string, PendingStage>();
  let lastApply = Promise.resolve();
  const flush = (name: string) => {
    const item = pending.get(name);
    if (!item) return lastApply;
    clearTimeout(item.timer);
    pending.delete(name);
    const patch: RouteStatePatch = {
      path: ["fields", name, "staged"],
      value: { value: item.value },
    };
    const applied = lastApply
      .catch(() => undefined)
      .then(async () => {
        try {
          expectRouteWrite(await apply([patch]));
          item.resolve();
        } catch (cause) {
          write("stage", "failure", () => registry.set(core.failure, verbFailure("stage", cause)));
          item.reject(cause);
          throw cause;
        }
      });
    lastApply = applied;
    return applied;
  };
  const stage = (name: string, value: unknown) => {
    const prior = pending.get(name);
    if (prior) {
      clearTimeout(prior.timer);
      prior.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => void flush(name).catch(() => undefined), 150);
      pending.set(name, { timer, resolve, reject, value });
    });
  };
  const flushPending = async () => {
    await Promise.all([...pending.keys()].map(flush));
    await lastApply;
  };
  const bindDocument = async (
    target: string | null,
    documentId: SettingsRouteDocument["documentId"] = null,
  ) => {
    const patches: RouteStatePatch[] = [
      {
        path: ["bindings", "file"],
        value: target ? { id: target, label: target } : undefined,
      },
      { path: ["documentId"], value: documentId },
    ];
    expectRouteWrite(await apply(patches));
    return target ? `bound ${target}` : "unbound settings file";
  };
  const bindPickedDocument = async (target: string | null) => {
    if (!target) return bindDocument(null);
    const { moduleKey, rootKey } = registry.get(picker);
    if (!moduleKey || !rootKey) return bindDocument(target);
    const result = registry.get(treeResult);
    const file =
      (AsyncResult.isSuccess(result)
        ? result.value.value.find((item) => item.path === target)
        : undefined) ??
      (await deps.host.tree(moduleKey, rootKey)).find((item) => item.path === target);
    return bindDocument(
      target,
      file ? { moduleKey, rootKey, relativePath: file.relativePath } : null,
    );
  };

  const actions = {
    setPicker: (value: Setter<SettingsPicker>) => set("pick", picker, value),
    setTargeting: (value: Setter<HeadPicker>) => set("targeting", targeting, value),
    stage: (name: string, value: unknown) => write("stage", name, () => stage(name, value)),
    apply: (patches: RouteStatePatch[]) =>
      write("apply", "slice/fields", async () => expectRouteWrite(await apply(patches))),
    open: () =>
      runVerb(
        "open",
        async () => {
          const { moduleKey, rootKey, filePath } = registry.get(picker);
          if (!moduleKey || !rootKey || !filePath)
            throw Error("open needs a module, root, and file");
          const result = registry.get(treeResult);
          const files = AsyncResult.isSuccess(result)
            ? result.value.value
            : await deps.host.tree(moduleKey, rootKey);
          const file =
            files.find((item) => item.path === filePath) ??
            (await deps.host.tree(moduleKey, rootKey)).find((item) => item.path === filePath);
          if (!file) throw Error("open needs a file from the current settings tree");
          if (registry.get(document)?.bindings.file?.id !== file.path)
            await bindDocument(file.path, {
              moduleKey,
              rootKey,
              relativePath: file.relativePath,
            });
          expectRouteWrite(
            await command("open", {
              documentId: { moduleKey, rootKey, relativePath: file.relativePath },
            }),
          );
          return `opened ${file.relativePath}`;
        },
        ["settings", "settings.schema"],
      ),
    refresh: () =>
      runVerb(
        "refresh",
        async () => {
          expectRouteWrite(await command("refresh"));
          return "re-read settings";
        },
        ["settings", "settings.schema"],
      ),
    validate: () =>
      runVerb(
        "validate",
        async () => {
          expectRouteWrite(await command("validate", { includeProposals: false }));
          return "validated settings";
        },
        ["settings"],
      ),
    save: () =>
      runVerb(
        "save",
        async () => {
          await flushPending();
          expectRouteWrite(await command("save"));
          return "saved settings";
        },
        ["settings"],
      ),
    bind: (target: string | null) =>
      runVerb("bind", () => bindPickedDocument(target), ["settings"]),
  };

  return {
    registry,
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
      sliceError,
      picker,
      targeting,
      ...core.verbAtoms,
    },
    feeds: {
      workspace: workspaceFeed,
      module: moduleFeed,
      root: rootFeed,
      file: fileFeed,
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
