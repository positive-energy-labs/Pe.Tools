import { Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  familiesRouteState,
  type AppliedScope,
  type FamiliesRouteDocument,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import type { FfProjectData } from "#/host/familyfoundry";
import { mintSelector, sessionLabel } from "#/host/target";
import type { FamiliesDraft, FamiliesHost } from "#/families/host";
import {
  createRouteStoreCore,
  docAtom,
  feed,
  hostRead,
  type Scope,
  type Slice,
} from "#/state/route-store";

export interface FamiliesSearchPort {
  readonly target: string;
  patch(partial: { target?: string }): void;
}
type Setter<A> = A | ((previous: A) => A);
type PickerState = { open: string | null; level: string | null; query: string; stage: string };
type FamiliesSlice = Atom.Atom<AsyncResult.AsyncResult<Slice<FamiliesRouteDocument>, Error>>;
const emptyTable = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

export function createFamiliesStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  host: FamiliesHost;
  search: FamiliesSearchPort;
  slice?: FamiliesSlice;
}) {
  const core = createRouteStoreCore("families", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);

  const slice = owned("slice/families", deps.slice ?? docAtom(familiesRouteState, deps.scope));
  const document = Atom.make((get): FamiliesRouteDocument | null => {
    const result = get(slice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const profilePath = Atom.make((get) => get(document)?.profilePath ?? null).pipe(
    owned("view/profile-path"),
  );
  const plan = Atom.make((get) => get(document)?.plan ?? null).pipe(owned("view/plan"));
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
  const table = Atom.make(emptyTable()).pipe(owned("page/table"));
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
  const categorySource = runtime.atom(() =>
    hostRead([deps.search.target], () => deps.host.categories(deps.search.target)),
  );
  const categoryResult = runtimeFactory
    .withReactivity(["category"])(
      Atom.swr(categorySource, { staleTime: "5 minutes", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const familySource = runtime.atom((get) => {
    const next = get(draft);
    return hostRead([deps.search.target, ...next.categories, next.placement], () =>
      next.categories.length ? deps.host.families(deps.search.target, next) : Promise.resolve([]),
    );
  });
  const familyResult = runtimeFactory
    .withReactivity(["family"])(
      Atom.swr(familySource, { staleTime: "5 minutes", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const profileSource = runtime.atom(() =>
    hostRead([deps.search.target], () => deps.host.profiles(deps.search.target)),
  );
  const profileResult = runtimeFactory
    .withReactivity(["profile"])(
      Atom.swr(profileSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);

  const sessionFeed = Atom.make((get) =>
    feed(
      get(sessionsResult),
      (sessions) =>
        sessions.map((session) => ({
          id: mintSelector(session, sessions),
          label: sessionLabel(session),
        })),
      "live",
    ),
  ).pipe(owned("feed/session"));
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
  const expectOk = (result: RouteStateWriteResult, fallback: string) => {
    if (!result.ok) throw Error(result.hint ?? result.error ?? fallback);
    return result;
  };
  const bindDocument = (nextTarget: string) =>
    deps.host
      .command("bind", { target: nextTarget || null })
      .then((result) => expectOk(result, "bind failed"));

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
          families: names.filter(
            (name) => !seen.has(name) || previous.families.includes(name),
          ),
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
    setShowUncommon: (value: Setter<boolean>) =>
      set("set-show-uncommon", showUncommon, value),
    setTable: (value: Setter<MasterTableState>) => set("set-table", table, value),
    setPicker: (value: Setter<PickerState>) => set("set-picker", picker, value),
    applyScope() {
      return runVerb(
        "apply-scope",
        async () => {
          const value = registry.get(draft);
          if (!value.categories.length || !value.families.length)
            throw Error("scope needs at least one category and family");
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
          expectOk(
            await deps.host.apply([
              { path: ["profilePath"], value: nextProfile },
              { path: ["plan"], value: null },
              { path: ["excludedIds"], value: [] },
              { path: ["apply"], value: null },
            ]),
            "profile binding failed",
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
          return expectOk(
            await deps.host.apply([{ path: ["excludedIds"], value: [...next] }]),
            "exclude failed",
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
          if (!path || !scope) throw Error("plan needs a profile and applied scope");
          await bindDocument(deps.search.target);
          return expectOk(
            await deps.host.command("plan", { profilePath: path, scope }),
            "plan failed",
          );
        },
        ["families"],
      );
    },
    applyFoundry() {
      return runVerb(
        "apply",
        async () => {
          const current = registry.get(plan);
          if (!current) throw Error("apply needs a plan");
          await bindDocument(deps.search.target);
          return expectOk(
            await deps.host.command("apply", { expectedPlanHash: current.planHash }),
            "apply failed",
          );
        },
        ["families", "matrix"],
      );
    },
    bind(nextTarget: string) {
      return runVerb(
        "bind",
        async () => {
          const result = await bindDocument(nextTarget);
          deps.search.patch({ target: nextTarget });
          return result;
        },
        ["session", "category", "family", "profile"],
      );
    },
    project() {
      return runVerb("project", async () => {
        const ids = [...registry.get(pickedIds)];
        if (!ids.length) throw Error("project needs picked families");
        const result = await deps.host.project(deps.search.target, ids);
        registry.set(projection, result);
        return `projected ${result.projections.length} families`;
      });
    },
    openPath(path: string) {
      return runVerb("open-path", async () => {
        await deps.host.openPath(deps.search.target, path);
        return `opened ${path}`;
      });
    },
  };

  return {
    registry,
    search: deps.search,
    slices: { families: slice },
    atoms: {
      profilePath,
      plan,
      excludedIds,
      applyData,
      draft,
      applied,
      pickedIds,
      projection,
      showUncommon,
      seenFamilies,
      table,
      picker,
      busy: core.busy,
      failure: core.failure,
      receipt: core.receipt,
    },
    feeds: { session: sessionFeed, category: categoryFeed, family: familyFeed, profile: profileFeed },
    actions,
    dispose() {
      unsubscribeFamilies();
      core.dispose();
    },
  };
}

export type FamiliesStore = ReturnType<typeof createFamiliesStore>;
