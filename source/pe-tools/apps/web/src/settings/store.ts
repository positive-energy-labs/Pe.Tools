import { Effect, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  settingsRouteState,
  settingsFieldSegments,
  type RouteStatePatch,
  type SettingsFieldState,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import { SettingsFileKind, type SettingsFileEntry } from "@pe/host-contracts/operation-types";

import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  feed,
  hostRead,
  readingIsCurrent,
  unbound,
  type Lane,
  type Scope,
} from "#/state/route-store";
import type { SettingsHost } from "#/settings/host";

interface SettingsSearchPort {
  readonly source?: "fixture";
}

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
  search: SettingsSearchPort;
}) {
  const core = createRouteStoreCore("settings", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);
  const lane: Lane = deps.search.source === "fixture" ? "fixture" : "read";

  const liveWriter = docWriter(settingsRouteState, deps.scope);
  const apply = deps.host.apply ?? liveWriter.apply;
  const command = deps.host.command ?? liveWriter.command;
  const settingsSlice = owned(
    "slice/settings",
    deps.host.document ?? docAtom(settingsRouteState, deps.scope),
  );
  const document = Atom.make((get): SettingsRouteDocument | null => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const snapshot = Atom.make((get) => {
    const doc = get(document);
    const value = doc?.snapshot;
    if (!value) return null;
    const target = doc.binding.target;
    return target && readingIsCurrent(value.from, { target, documentId: target }) ? value : null;
  }).pipe(owned("view/snapshot"));
  const fields = Atom.make((get) => get(document)?.fields ?? {}).pipe(owned("view/fields"));
  const validation = Atom.make((get) => get(snapshot)?.validation ?? null).pipe(
    owned("view/validation"),
  );
  const binding = Atom.make((get) => get(document)?.binding ?? { target: null }).pipe(
    owned("view/binding"),
  );
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
    const open = get(snapshot)?.from.settingsDocumentId;
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
          .filter(
            (entry) =>
              entry.kind !== SettingsFileKind.Fragment &&
              entry.kind !== SettingsFileKind.Schema &&
              !entry.isFragment &&
              !entry.isSchema &&
              entry.relativePath.toLowerCase().endsWith(".json"),
          )
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
  const expect = <T extends { ok: boolean; error?: string; hint?: string }>(
    result: T,
    fallback: string,
  ) => {
    if (!result.ok) throw Error(result.hint ?? result.error ?? fallback);
    return result;
  };
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
          expect(await apply([patch]), `staging ${name} failed`);
          item.resolve();
        } catch (cause) {
          write("stage", "failure", () =>
            registry.set(core.failure, {
              kind: "host",
              verb: "stage",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
          );
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
  const bindDocument = async (target: string | null) => {
    const doc = registry.get(document);
    const patches: RouteStatePatch[] = [
      {
        path: ["binding"],
        value: { target, boundAt: target ? new Date().toISOString() : null },
      },
    ];
    if (
      doc?.snapshot &&
      (!target || !readingIsCurrent(doc.snapshot.from, { target, documentId: target }))
    )
      patches.push({ path: ["snapshot"], value: null });
    expect(await apply(patches), "bind failed");
    return target ? `bound ${target}` : "unbound settings file";
  };

  const actions = {
    setPicker: (value: Setter<SettingsPicker>) => set("pick", picker, value),
    setTargeting: (value: Setter<HeadPicker>) => set("targeting", targeting, value),
    stage: (name: string, value: unknown) => write("stage", name, () => stage(name, value)),
    apply: (patches: RouteStatePatch[]) =>
      write("apply", "slice/fields", async () =>
        expect(await apply(patches), "field update failed"),
      ),
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
          if (registry.get(document)?.binding.target !== file.path) await bindDocument(file.path);
          expect(
            await command("open", {
              documentId: { moduleKey, rootKey, relativePath: file.relativePath },
            }),
            "open failed",
          );
          return `opened ${file.relativePath}`;
        },
        ["settings", "settings.schema"],
      ),
    refresh: () =>
      runVerb(
        "refresh",
        async () => {
          expect(await command("refresh"), "re-read failed");
          return "re-read settings";
        },
        ["settings", "settings.schema"],
      ),
    validate: () =>
      runVerb(
        "validate",
        async () => {
          expect(await command("validate", { includeProposals: false }), "validate failed");
          return "validated settings";
        },
        ["settings"],
      ),
    save: () =>
      runVerb(
        "save",
        async () => {
          await flushPending();
          expect(await command("save"), "save failed");
          return "saved settings";
        },
        ["settings"],
      ),
    bind: (target: string | null) => runVerb("bind", () => bindDocument(target), ["settings"]),
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
