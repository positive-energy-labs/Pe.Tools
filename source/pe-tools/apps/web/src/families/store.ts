import { Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  familiesRouteState,
  here,
  type AppliedScope,
  type FamiliesRouteDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import type { FfProjectData } from "#/host/familyfoundry";
import { bridgeSelector } from "@pe/agent-contracts";
import { documentAddress, scopeSession } from "#/host/target";
import type { FamiliesDraft, FamiliesHost } from "#/families/host";
import { familyFlag } from "#/families/plan";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  expectRouteWrite,
  refuse,
  feed,
  hostRead,
  type Scope,
  type Slice,
} from "#/state/route-store";

type Setter<A> = A | ((previous: A) => A);
type PickerState = { open: string | null; level: string | null; query: string; stage: string };
type FamiliesSlice = Atom.Atom<AsyncResult.AsyncResult<Slice<FamiliesRouteDocument>, Error>>;

export function createFamiliesStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  host: FamiliesHost;
  navigateTarget?: (target: string) => Promise<void>;
  slice?: FamiliesSlice;
  writer?: {
    apply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
    command(name: "plan" | "apply", input?: unknown): Promise<RouteStateWriteResult>;
  };
}) {
  const core = createRouteStoreCore("families", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);

  const slice = owned("slice/families", deps.slice ?? docAtom(familiesRouteState, deps.scope));
  const writer = deps.writer ?? docWriter(familiesRouteState, deps.scope, deps.registry, slice);
  const document = Atom.make((get): FamiliesRouteDocument | null => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  // ponytail: the world is the page Scope's session; rebinding is a `?target` navigation, not a doc write.
  // The host selector for this page: `doc:<Address>`, or `pin:<id>|doc:<Address>` when pinned.
  const target = Atom.make(() => bridgeSelector(deps.scope.scope) ?? "").pipe(
    owned("binding/world"),
  );
  const profilePath = Atom.make((get) => get(document)?.profilePath ?? null).pipe(
    owned("view/profile-path"),
  );
  const persistedPlan = Atom.make((get) => get(document)?.plan ?? null).pipe(Atom.autoDispose);
  const excludedIds = Atom.make((get) => get(document)?.excludedIds ?? []).pipe(
    owned("view/excluded-ids"),
  );
  const applyData = Atom.make((get) => get(document)?.apply ?? null).pipe(owned("view/apply"));

  const draft = Atom.make<FamiliesDraft>({
    placement: "AllLoaded",
    categories: [],
    families: [],
  }).pipe(owned("page/draft"));
  const applied = Atom.make<AppliedScope | null>(null).pipe(owned("page/applied"));
  const pickedIds = Atom.make<Set<number>>(new Set<number>()).pipe(owned("page/picked-ids"));
  const projection = Atom.make<FfProjectData | null>(null).pipe(owned("page/projection"));
  const showUncommon = Atom.make(false).pipe(owned("page/show-uncommon"));
  const seenFamilies = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
    owned("page/seen-families"),
  );
  const table = Atom.make<MasterTableState>({ filters: {}, sorts: [], query: "" }).pipe(
    owned("page/table"),
  );
  const picker = Atom.make<PickerState>({
    open: null,
    level: null,
    query: "",
    stage: "scope",
  }).pipe(owned("page/picker"));
  const sessionsSource = runtime.atom(() => hostRead(["sessions"], deps.host.sessions));
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(
      Atom.swr(sessionsSource, { staleTime: "5 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const plan = Atom.make((get) => {
    const value = get(persistedPlan);
    const doc = get(document);
    if (!value || !doc) return null;
    const sessions = get(sessionsResult);
    const session = AsyncResult.isSuccess(sessions)
      ? scopeSession(deps.scope.scope, sessions.value.value)
      : null;
    if (!session) return null;
    return value.reading
      ? here(
          value as typeof value & { reading: NonNullable<typeof value.reading> },
          documentAddress(session),
        )
      : value;
  }).pipe(owned("view/plan"));
  const categorySource = runtime.atom(() =>
    hostRead([registry.get(target)], () => deps.host.categories(registry.get(target))),
  );
  const categoryResult = runtimeFactory
    .withReactivity(["category"])(
      Atom.swr(categorySource, { staleTime: "5 minutes", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const familyCategories = Atom.map(draft, (value) => value.categories);
  const familyPlacement = Atom.map(draft, (value) => value.placement);
  const familySource = runtime.atom((get) => {
    const next = {
      categories: get(familyCategories),
      placement: get(familyPlacement),
      families: [],
    };
    const world = get(target);
    return hostRead([world, ...next.categories, next.placement], () =>
      next.categories.length ? deps.host.families(world, next) : Promise.resolve([]),
    );
  });
  const familyResult = runtimeFactory
    .withReactivity(["family"])(familySource)
    .pipe(Atom.autoDispose);
  const profileSource = runtime.atom(() =>
    hostRead(["family-foundry"], () => deps.host.profiles()),
  );
  const profileResult = runtimeFactory
    .withReactivity(["profile"])(
      Atom.swr(profileSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);

  const categoryFeed = Atom.make((get) =>
    feed(get(categoryResult), (names) => names.map((name) => ({ id: name, label: name })), "read"),
  ).pipe(owned("feed/category"));
  const familyFeed = Atom.make((get) =>
    feed(get(familyResult), (names) => names.map((name) => ({ id: name, label: name })), "read"),
  ).pipe(owned("feed/family"));
  const profileFeed = Atom.make((get) =>
    feed(get(profileResult), (paths) => paths.map((path) => ({ id: path, label: path })), "read"),
  ).pipe(owned("feed/profile"));

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    write(verb, atom.label?.[0] ?? "page", () =>
      registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const unsubscribeFamilies = registry.subscribe(
    familyFeed,
    (nextFeed) => {
      if (nextFeed.state !== "ready" || nextFeed.options === null) return;
      const names = nextFeed.options.map((option) => option.id);
      const available = new Set(names);
      const seen = registry.get(seenFamilies);
      Atom.batch(() => {
        registry.set(seenFamilies, available);
        registry.update(draft, (previous) => ({
          ...previous,
          families: names.filter((name) => !seen.has(name) || previous.families.includes(name)),
        }));
      });
    },
    { immediate: true },
  );

  const actions = {
    setDraft: (value: Setter<FamiliesDraft>) => set("set-draft", draft, value),
    setPickedIds: (value: Setter<Set<number>>) => set("set-picked-ids", pickedIds, value),
    setProjection: (value: Setter<FfProjectData | null>) =>
      set("set-projection", projection, value),
    setShowUncommon: (value: Setter<boolean>) => set("set-show-uncommon", showUncommon, value),
    setTable: (value: Setter<MasterTableState>) => set("set-table", table, value),
    setPicker: (value: Setter<PickerState>) => set("set-picker", picker, value),
    applyScope() {
      return runVerb(
        "apply-scope",
        async () => {
          const value = registry.get(draft);
          if (!value.categories.length || !value.families.length)
            refuse("scope needs at least one category and family");
          registry.set(applied, {
            categoryNames: [...value.categories],
            familyNames: [...value.families],
            placementScope: value.placement,
          });
          return `scope applied to ${value.families.length} families`;
        },
        ["matrix"],
      );
    },
    setProfile(nextProfile: string) {
      return runVerb(
        "profile",
        async () =>
          expectRouteWrite(
            await writer.apply([
              { path: ["profilePath"], value: nextProfile },
              { path: ["plan"], value: null },
              { path: ["excludedIds"], value: [] },
              { path: ["apply"], value: null },
            ]),
          ),
        ["families"],
      );
    },
    exclude(id: number) {
      return runVerb(
        "exclude",
        async () => {
          const next = new Set(registry.get(excludedIds));
          if (!next.delete(id)) next.add(id);
          return expectRouteWrite(
            await writer.apply([{ path: ["excludedIds"], value: [...next] }]),
          );
        },
        ["families"],
      );
    },
    plan() {
      return runVerb(
        "plan",
        async () => {
          const path = registry.get(profilePath);
          const scope = registry.get(applied);
          if (!path || !scope) refuse("plan needs a profile and applied scope");
          return expectRouteWrite(await writer.command("plan", { profilePath: path, scope }));
        },
        ["families"],
      );
    },
    applyFoundry() {
      return runVerb(
        "apply",
        async () => {
          const current = registry.get(plan);
          if (!current) refuse("apply needs a plan");
          return expectRouteWrite(
            await writer.command("apply", {
              expectedPlanHashes: Object.fromEntries(
                current.entries
                  .filter(
                    (entry) =>
                      !registry.get(excludedIds).includes(entry.familyId) && !familyFlag(entry),
                  )
                  .map((entry) => [String(entry.familyId), entry.planHash]),
              ),
            }),
          );
        },
        ["families", "matrix"],
      );
    },
    bind(nextTarget: string) {
      return runVerb(
        "bind",
        async () => {
          if (!deps.navigateTarget) refuse("Target navigation is unavailable on this surface.");
          await deps.navigateTarget(nextTarget);
          return `bound ${nextTarget}`;
        },
        ["session", "category", "family", "profile"],
      );
    },
    project() {
      return runVerb("project", async () => {
        const ids = [...registry.get(pickedIds)];
        if (!ids.length) refuse("project needs picked families");
        const result = await deps.host.project(registry.get(target), ids);
        registry.set(projection, result);
        return `projected ${result.families.length} families`;
      });
    },
    openFamily(familyId: number) {
      return runVerb("open-family", async () => {
        const opened = await deps.host.openFamily(registry.get(target), familyId);
        if (!opened.savedPath)
          refuse("The family editor returned no document path; navigation was not completed.");
        return {
          doc: address(opened.savedPath!),
          target: deps.scope.scope.kind === "document" ? deps.scope.scope.pin : undefined,
          capture: true as const,
        };
      });
    },
    openPath(path: string) {
      return runVerb("open-path", async () => {
        await deps.host.openPath(registry.get(target), path);
        return `opened ${path}`;
      });
    },
  };

  return {
    scope: deps.scope,
    registry,
    atoms: {
      target,
      profilePath,
      plan,
      excludedIds,
      applyData,
      draft,
      applied,
      pickedIds,
      projection,
      showUncommon,
      table,
      picker,
      ...core.verbAtoms,
    },
    feeds: {
      category: categoryFeed,
      family: familyFeed,
      profile: profileFeed,
    },
    actions,
    dispose() {
      unsubscribeFamilies();
      core.dispose();
    },
  };
}

export type FamiliesStore = ReturnType<typeof createFamiliesStore>;
