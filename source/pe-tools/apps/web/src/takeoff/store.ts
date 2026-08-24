import { Cause, Effect, Layer, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { mintSelector, resolveTarget, type SessionFacts } from "#/host/target";
import type { AdoptItem } from "#/takeoff/scripts";
import type { CandidateRegion, LiveRegion, ViewFacts } from "#/takeoff/model";
import type { RoomEdit, World, WorldRoom } from "#/takeoff/world";
import {
  pickInto,
  type Bound,
  type Feed,
  type Link,
  type Multi,
  type Product,
} from "#/targeting/model";

export type TakeoffStage = "adopt" | "audit" | "sync";

export interface TakeoffSearch {
  readonly target: string;
  readonly source: "live" | "fixture";
  readonly view: string;
  readonly zones: readonly string[];
  readonly dir: string;
  readonly r10: string;
  readonly stage: TakeoffStage;
}

export const EMPTY_TAKEOFF_SEARCH: TakeoffSearch = {
  target: "",
  source: "live",
  view: "",
  zones: [],
  dir: "",
  r10: "",
  stage: "adopt",
};

export interface SearchPort {
  patch(partial: Partial<TakeoffSearch>): void;
}

export type SessionEvent =
  | { readonly kind: "docChanged"; readonly sessionId: string }
  | { readonly kind: "sessionGone"; readonly sessionId: string };

export interface ActiveDocument {
  readonly session: SessionFacts;
  readonly title: string;
}

export interface SessionSource {
  list(): Promise<SessionFacts[]>;
  activeDocument(session: SessionFacts): Promise<ActiveDocument>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface TakeoffSnapshot {
  readonly world: World;
  readonly views: ViewFacts[];
  readonly zoneFrs: CandidateRegion[];
  readonly regionsByZone: Record<string, LiveRegion[]>;
}

export interface RhvacFile {
  readonly path: string;
  readonly name: string;
}

export interface TakeoffHost {
  readonly fixture: boolean;
  readSnapshot(session: SessionFacts, document: ActiveDocument): Promise<TakeoffSnapshot>;
  listRhvac(dir: string): Promise<RhvacFile[]>;
  openRhvac(path: string): Promise<unknown>;
  adopt(
    session: SessionFacts,
    input: { readonly view: string; readonly items: readonly AdoptItem[] },
  ): Promise<{ readonly text: string }>;
}

export interface TimedRead<A> {
  readonly value: A;
  readonly at: number;
  readonly basis: readonly string[];
  readonly bound: boolean;
}

export interface TakeoffFeed extends Feed {
  readonly basis?: readonly string[];
}

export interface VerbFailure {
  readonly kind: "busy" | "host";
  readonly verb: string;
  readonly message: string;
}

export interface VerbReceipt {
  readonly verb: string;
  readonly text: string;
  readonly at: number;
}

export interface StagedRoomEdit {
  readonly base: RoomEdit;
  readonly next: RoomEdit;
}

export interface AtlasPageState {
  readonly stageFilter: World["zones"][number]["stage"] | null;
  readonly level: string;
  readonly zoneKey: string | null;
  readonly cursor: string | null;
  readonly fieldsMode: "columns" | "panel";
  readonly visibleKeys: readonly string[];
}

const LINKS: Link[] = [
  { key: "world", joiner: "in", placeholder: "pick a world", needs: "a world" },
  { key: "rvt", parent: "world", joiner: "", placeholder: "no document", needs: "a document" },
  {
    key: "view",
    parent: "rvt",
    joiner: "from",
    placeholder: "pick a zoning plan",
    needs: "views",
    dir: "read",
  },
  {
    key: "zones",
    parent: "rvt",
    joiner: "into",
    placeholder: "pick zones",
    needs: "zones",
    dir: "write",
    multi: true,
  },
  { key: "folder", joiner: "beside", placeholder: "pick a folder", needs: "a folder" },
  {
    key: "r10",
    parent: "folder",
    joiner: "syncing",
    placeholder: "pick a .r10",
    needs: ".r10 files",
    dir: "sync",
  },
];

const BINDINGS: Product = {
  key: "takeoffs",
  name: "takeoffs",
  links: LINKS,
  stages: [],
  panes: [],
};
const EMPTY_WORLD: World = { docName: "", r10Path: null, lanes: [], zones: [], systems: [] };

const timed = <A>(basis: readonly string[], read: () => Promise<A>) =>
  Effect.tryPromise({
    try: read,
    catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
  }).pipe(Effect.map((value): TimedRead<A> => ({ value, at: Date.now(), basis, bound: true })));

const unbound = <A>(value: A, basis: readonly string[] = []): TimedRead<A> => ({
  value,
  at: Date.now(),
  basis,
  bound: false,
});

export function resultFeed<A>(
  result: AsyncResult.AsyncResult<TimedRead<A>, Error>,
  options: (value: A) => Feed["options"],
  fixture: boolean,
  live = false,
): TakeoffFeed {
  if (AsyncResult.isInitial(result))
    return { options: null, state: "loading", note: "not read yet" };
  if (AsyncResult.isFailure(result))
    return { options: null, state: "error", note: String(Cause.squash(result.cause)) };
  if (!result.value.bound)
    return {
      options: null,
      state: fixture ? "fixture" : "fresh",
      note: "unbound; no host read",
      basis: result.value.basis,
    };
  return {
    options: options(result.value.value),
    state: result.waiting ? "stale" : fixture ? "fixture" : live ? "live" : "fresh",
    at: result.value.at,
    basis: result.value.basis,
  };
}

export function createTakeoffStore(deps: {
  host: TakeoffHost;
  sessions: SessionSource;
  search: SearchPort;
}) {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty);
  let busyTimer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let currentHover = "";
  const stagedIds = new Set<string>();

  const searchAtom = Atom.make<TakeoffSearch>(EMPTY_TAKEOFF_SEARCH).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search"),
  );
  const targetAtom = Atom.make((get) => get(searchAtom).target).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/target"),
  );
  const sourceAtom = Atom.make((get) => get(searchAtom).source).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/source"),
  );
  const viewAtom = Atom.make((get) => get(searchAtom).view).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/view"),
  );
  const zonesAtom = Atom.make((get) => get(searchAtom).zones).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/zones"),
  );
  const dirAtom = Atom.make((get) => get(searchAtom).dir).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/dir"),
  );
  const r10PathAtom = Atom.make((get) => get(searchAtom).r10).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/r10"),
  );
  const stageAtom = Atom.make((get) => get(searchAtom).stage).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/search/stage"),
  );
  const recentDirsAtom = Atom.make<readonly string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/persisted/recent-dirs"),
  );
  const actionsLogAtom = Atom.make<string[]>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/actions"),
  );
  const busyAtom = Atom.make<{ id: string; seconds: number } | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/busy"),
  );
  const failureAtom = Atom.make<VerbFailure | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/failure"),
  );
  const receiptAtom = Atom.make<VerbReceipt | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("takeoffs/verb/receipt"),
  );
  const atlasPageAtom = Atom.make<AtlasPageState>({
    stageFilter: null,
    level: "",
    zoneKey: null,
    cursor: null,
    fieldsMode: "columns",
    visibleKeys: [],
  }).pipe(Atom.withLabel("takeoffs/page/atlas"));
  const hoveredAtom = Atom.family((id: string) =>
    Atom.make(false).pipe(Atom.withLabel(`takeoffs/entity/${id}/hovered`)),
  );
  const selectedAtom = Atom.family((id: string) =>
    Atom.make(false).pipe(Atom.withLabel(`takeoffs/entity/${id}/selected`)),
  );
  const decidedAtom = Atom.family((id: string) =>
    Atom.make<Readonly<Record<string, "accept" | "dismiss">>>({}).pipe(
      Atom.withLabel(`takeoffs/entity/${id}/decided`),
    ),
  );
  const stagedAtom = Atom.family((id: string) =>
    Atom.make<StagedRoomEdit | null>(null).pipe(Atom.withLabel(`takeoffs/entity/${id}/staged`)),
  );

  const sessionsSource = runtime
    .atom(() => timed(["sessions"], () => deps.sessions.list()))
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/sessions"));
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(sessionsSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/sessions"));
  const activeDocumentSource = runtime
    .atom((get) => {
      const target = get(targetAtom);
      return Effect.gen(function* () {
        const read = yield* get.result(sessionsResult, { suspendOnWaiting: true });
        const resolution = resolveTarget(read.value, target);
        if (resolution.kind !== "resolved") return unbound<ActiveDocument | null>(null, [target]);
        const document = yield* timed([resolution.session.sessionId], () =>
          deps.sessions.activeDocument(resolution.session),
        );
        return document;
      });
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/active-document"));
  const activeDocumentResult = runtimeFactory
    .withReactivity(["active-document"])(activeDocumentSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/active-document"));
  const snapshotSource = runtime
    .atom((get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        if (!document.value) return unbound<TakeoffSnapshot | null>(null, document.basis);
        return yield* timed([document.value.session.sessionId, document.value.title], () =>
          deps.host.readSnapshot(document.value!.session, document.value!),
        );
      }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/snapshot"));
  const snapshotResult = runtimeFactory
    .withReactivity(["snapshot"])(
      Atom.swr(snapshotSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/snapshot"));
  const foldersSource = runtime
    .atom((get) =>
      Effect.succeed({
        value: get(recentDirsAtom),
        at: Date.now(),
        basis: ["browser"],
        bound: true,
      } satisfies TimedRead<readonly string[]>),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/folders"));
  const foldersResult = runtimeFactory
    .withReactivity(["folders"])(foldersSource)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/folders"));
  const listingSource = runtime
    .atom((get) => {
      const dir = get(dirAtom);
      return dir
        ? timed([dir], () => deps.host.listRhvac(dir))
        : Effect.succeed(unbound<RhvacFile[]>([], []));
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/rhvac-list"));
  const listingResult = runtimeFactory
    .withReactivity(["rhvac-list"])(
      Atom.swr(listingSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/rhvac-list"));
  const r10Source = runtime
    .atom((get) => {
      const path = get(r10PathAtom);
      return Effect.gen(function* () {
        const files = yield* get.result(listingResult, { suspendOnWaiting: true });
        if (!path) return unbound<unknown>(null, files.basis);
        if (!files.value.some((file) => file.path === path))
          return yield* Effect.fail(Error(`unknown .r10 ${path}`));
        return yield* timed([path], () => deps.host.openRhvac(path));
      });
    })
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/source/r10-open"));
  const r10Result = runtimeFactory
    .withReactivity(["rhvac-open"])(r10Source)
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/result/r10-open"));

  const sessionsFeed = Atom.make((get) =>
    resultFeed(
      get(sessionsResult),
      (items) =>
        items.map((session) => ({
          id: mintSelector(session, items),
          label: session.activeDocumentTitle ?? `Revit ${session.processId}`,
        })),
      deps.host.fixture,
      true,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/world"));
  const documentFeed = Atom.make((get) =>
    resultFeed(
      get(activeDocumentResult),
      (document) => (document ? [{ id: document.title, label: document.title }] : []),
      deps.host.fixture,
      true,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/rvt"));
  const viewFeed = Atom.make((get) =>
    resultFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot?.views.map((view) => ({ id: view.name, label: view.name, sub: view.level })) ?? [],
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/view"));
  const zonesFeed = Atom.make((get) =>
    resultFeed(
      get(snapshotResult),
      (snapshot) =>
        snapshot?.world.zones.map((zone) => ({ id: zone.zone.guid, label: zone.name })) ?? [],
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/zones"));
  const folderFeed = Atom.make((get) =>
    resultFeed(
      get(foldersResult),
      (dirs) => dirs.map((dir) => ({ id: dir, label: dir })),
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/folder"));
  const r10Feed = Atom.make((get) =>
    resultFeed(
      get(listingResult),
      (files) => files.map((file) => ({ id: file.path, label: file.name })),
      deps.host.fixture,
    ),
  ).pipe(Atom.withLabel("takeoffs/feed/r10"));
  const worldAtom = Atom.make((get): World => {
    const result = get(snapshotResult);
    if (AsyncResult.isSuccess(result)) return result.value.value?.world ?? EMPTY_WORLD;
    if (AsyncResult.isFailure(result))
      return Option.getOrUndefined(result.previousSuccess)?.value.value?.world ?? EMPTY_WORLD;
    return EMPTY_WORLD;
  }).pipe(Atom.withLabel("takeoffs/world"));
  const roomsByIdAtom = Atom.make(
    (get) =>
      new Map(
        get(worldAtom)
          .zones.flatMap((zone) => zone.rooms)
          .map((room) => [room.guid, room] as const),
      ),
  ).pipe(Atom.withLabel("takeoffs/rooms-by-id"));
  const decisionsAtom = Atom.make((get) =>
    Object.fromEntries(
      [...get(roomsByIdAtom).keys()].flatMap((id) =>
        Object.entries(get(decidedAtom(id))).map(([flag, verdict]) => [`${id}::${flag}`, verdict]),
      ),
    ),
  ).pipe(Atom.withLabel("takeoffs/page/decisions"));
  const entityAtom = Atom.family((id: string) =>
    Atom.make((get) => {
      const authority = get(roomsByIdAtom).get(id);
      const staged = get(stagedAtom(id));
      return {
        hovered: get(hoveredAtom(id)),
        selected: get(selectedAtom(id)),
        decided: get(decidedAtom(id)),
        staged,
        dirty: staged !== null,
        conflict:
          staged !== null &&
          authority !== undefined &&
          Object.entries(staged.base).some(
            ([key, value]) => authority[key as keyof WorldRoom] !== value,
          ),
      };
    }).pipe(Atom.withLabel(`takeoffs/entity/${id}`)),
  );

  const invalidateAtom = runtime
    .fn((keys: readonly string[]) => Reactivity.invalidate(keys))
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/invalidate"));
  const adoptMutation = runtime
    .fn((input: { readonly view: string; readonly items: readonly AdoptItem[] }, get) =>
      Effect.gen(function* () {
        const document = yield* get.result(activeDocumentResult, { suspendOnWaiting: true });
        if (!document.value) return yield* Effect.fail(Error("no document bound"));
        const receipt = yield* Effect.tryPromise({
          try: () => deps.host.adopt(document.value!.session, input),
          catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
        });
        yield* Reactivity.invalidate(["snapshot"]);
        return receipt;
      }),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("takeoffs/verb/adopt"));

  const log = (text: string) =>
    registry.update(actionsLogAtom, (items) => [...items, text].slice(-20));
  const settle = <A>(atom: Atom.Atom<AsyncResult.AsyncResult<A, Error>>) => {
    registry.get(atom);
    return Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }));
  };
  const runVerb = async <A>(id: string, work: () => Promise<A>): Promise<A> => {
    if (inFlight) {
      const failure = {
        kind: "busy",
        verb: id,
        message: `${id} refused; another verb is running`,
      } as const;
      registry.set(failureAtom, failure);
      throw Error(failure.message);
    }
    inFlight = true;
    registry.set(failureAtom, null);
    registry.set(busyAtom, { id, seconds: 0 });
    const started = Date.now();
    busyTimer = setInterval(
      () => registry.set(busyAtom, { id, seconds: Math.floor((Date.now() - started) / 1000) }),
      250,
    );
    try {
      const value = await work();
      registry.set(receiptAtom, { verb: id, text: id, at: Date.now() });
      log(`${id} succeeded`);
      return value;
    } catch (cause) {
      const failure = {
        kind: "host",
        verb: id,
        message: cause instanceof Error ? cause.message : String(cause),
      } as const;
      registry.set(failureAtom, failure);
      log(`${id} failed`);
      throw cause;
    } finally {
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = undefined;
      inFlight = false;
      registry.set(busyAtom, null);
    }
  };
  const clearStaging = () => {
    for (const id of stagedIds) registry.set(stagedAtom(id), null);
    stagedIds.clear();
  };
  const setSearch = (next: TakeoffSearch) => {
    const previous = registry.get(searchAtom);
    const before = new Set(previous.zones);
    const after = new Set(next.zones);
    Atom.batch(() => {
      registry.set(searchAtom, next);
      for (const id of new Set([...before, ...after]))
        if (before.has(id) !== after.has(id)) registry.set(selectedAtom(id), after.has(id));
    });
    if (previous.target !== next.target || previous.view !== next.view) clearStaging();
  };
  const pick = (key: Link["key"], id: string) => {
    const current = registry.get(searchAtom);
    const bound: Bound = {
      world: current.target || null,
      rvt: null,
      view: current.view || null,
      folder: current.dir || null,
      r10: current.r10 || null,
    };
    const multi: Multi = { zones: new Set(current.zones) };
    const link = LINKS.find((candidate) => candidate.key === key);
    if (!link) throw Error(`unknown takeoff binding ${key}`);
    const next = pickInto(BINDINGS, bound, multi, link, id);
    deps.search.patch({
      target: next.bound.world ?? "",
      view: next.bound.view ?? "",
      zones: [...(next.multi.zones ?? [])],
      dir: next.bound.folder ?? "",
      r10: next.bound.r10 ?? "",
    });
  };

  const unsubscribe = deps.sessions.subscribe((event) => {
    const document = registry.get(activeDocumentResult);
    const current = AsyncResult.isSuccess(document)
      ? document.value.value?.session.sessionId
      : null;
    if (current !== event.sessionId) return;
    log(`push ${event.kind} ${event.sessionId}`);
    registry.set(invalidateAtom, event.kind === "docChanged" ? ["active-document"] : ["sessions"]);
  });

  const feeds = {
    world: sessionsFeed,
    rvt: documentFeed,
    view: viewFeed,
    zones: zonesFeed,
    folder: folderFeed,
    r10: r10Feed,
  };
  const actions = {
    setSearch,
    pick,
    settle,
    invalidate: (keys: readonly string[]) => registry.set(invalidateAtom, keys),
    rememberDir(dir: string) {
      const value = dir.trim();
      if (!value) return;
      registry.update(recentDirsAtom, (dirs) =>
        [value, ...dirs.filter((item) => item !== value)].slice(0, 8),
      );
    },
    hover(id: string) {
      if (id === currentHover) return;
      Atom.batch(() => {
        if (currentHover) registry.set(hoveredAtom(currentHover), false);
        currentHover = id;
        if (id) registry.set(hoveredAtom(id), true);
      });
    },
    setAtlasPage(patch: Partial<AtlasPageState>) {
      registry.update(atlasPageAtom, (page) => ({ ...page, ...patch }));
    },
    decide(id: string, flag: string, verdict: "accept" | "dismiss") {
      registry.update(decidedAtom(id), (decisions) => ({ ...decisions, [flag]: verdict }));
    },
    stage(id: string, base: RoomEdit, next: RoomEdit) {
      const staged = JSON.stringify(base) === JSON.stringify(next) ? null : { base, next };
      registry.set(stagedAtom(id), staged);
      if (staged) stagedIds.add(id);
      else stagedIds.delete(id);
    },
    adopt(input: { readonly view: string; readonly items: readonly AdoptItem[] }) {
      return runVerb("adopt", async () => {
        registry.set(adoptMutation, input);
        return settle(adoptMutation);
      });
    },
  };

  return {
    atoms: {
      registry,
      search: searchAtom,
      target: targetAtom,
      source: sourceAtom,
      view: viewAtom,
      zones: zonesAtom,
      dir: dirAtom,
      r10Path: r10PathAtom,
      stage: stageAtom,
      world: worldAtom,
      atlasPage: atlasPageAtom,
      decisions: decisionsAtom,
      sessions: sessionsResult,
      activeDocument: activeDocumentResult,
      snapshot: snapshotResult,
      listing: listingResult,
      r10: r10Result,
      entity: entityAtom,
      busy: busyAtom,
      failure: failureAtom,
      receipt: receiptAtom,
    },
    actions,
    feeds,
    inspect() {
      return {
        url: registry.get(searchAtom),
        persisted: { recentDirs: registry.get(recentDirsAtom) },
        page: {
          hover: currentHover,
          staged: [...stagedIds],
          busy: registry.get(busyAtom),
          failure: registry.get(failureAtom),
          receipt: registry.get(receiptAtom),
        },
        feeds: Object.fromEntries(
          Object.entries(feeds).map(([key, atom]) => [key, registry.get(atom)]),
        ),
        actions: registry.get(actionsLogAtom),
      };
    },
    dispose() {
      unsubscribe();
      if (busyTimer) clearInterval(busyTimer);
      registry.dispose();
    },
  };
}

export type TakeoffStore = ReturnType<typeof createTakeoffStore>;
