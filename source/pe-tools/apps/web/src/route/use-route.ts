/**
 * `useRoute(manifest)` — the one owner. It replaces `state/route-store.ts`, `state/registry.ts`,
 * `state/use-route-store.ts` and `targeting/actions.ts`: a route hands it a manifest and gets back
 * a resolution, its Work, its Readings, its Page, and one handle per action. Refusals are
 * RETURNED (`route/refusal.ts`), never thrown.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addressSchema,
  parseRouteDoc,
  resolveCallTarget,
  sameAddress,
  threadHeadSchema,
  workKey,
  type Address,
  type DocumentRequest,
  type ExecutionTarget,
  type Reading,
  type ReadingRequest,
  type RouteDocOf,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
  type TargetResolution,
  type WorkKey,
} from "@pe/agent-contracts";
import { Equal, Hash, Layer, Option } from "effect";
/** A Reading of one shape becomes a Reading of another; every lifecycle state is preserved. */
const readingMap = <A, B>(reading: Reading<A>, f: (value: A) => B): Reading<B> =>
  reading.state === "ready"
    ? { state: "ready", observation: f(reading.observation) }
    : reading.state === "absent"
      ? reading
      : reading.previous === undefined
        ? (reading as Reading<B>)
        : ({ ...reading, previous: f(reading.previous) } as Reading<B>);
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { readingAtom, peReadings, previousOf, targetInventory, type Readings } from "#/readings";
import { inspectAtomRegistry, type OwnerReferences } from "#/state/atom-inspect";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";
import type { RouteManifest } from "./manifest";
import { callHostDynamic } from "#/host/client";
import { causeRefusal, refuse, writeRefusal, type Refusal } from "./refusal";

/** A resolved Target is only ever two headers on the one `/call` endpoint. */
const targetHeaders = (target: ExecutionTarget) =>
  target.kind === "session"
    ? { bridgeSessionId: target.session }
    : target.kind === "document"
      ? { bridgeSessionId: target.ref.session, openDocumentId: target.ref.openId }
      : {};

/**
 * The one place a registry is constructed (fable law 5). `?demo=` owners get their own isolated
 * registry from here rather than reaching for `AtomRegistry.make` a second time.
 */
export const makeAtomRegistry = (options?: Parameters<typeof AtomRegistry.make>[0]) =>
  AtomRegistry.make(options);

/** The app's one registry. Was `state/registry.ts`. */
export const appAtomRegistry = makeAtomRegistry({ defaultIdleTTL: 400 });

/** A conflict banner is a projection of the last stale-revision write, not a second state model. */
export const routeConflictAtom = Atom.make(false).pipe(Atom.withLabel("app/route-conflict"));

/** A render subscribed to one atom in the owner's registry; `null` atom reads as `null`. */
function useOwned<A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A> | null): A | null {
  const subscribe = useMemo(
    () => (notify: () => void) => (atom ? registry.subscribe(atom, notify) : () => {}),
    [registry, atom],
  );
  return useSyncExternalStore(subscribe, () => (atom ? registry.get(atom) : null));
}

export type Slice<D> = ({ doc: D; revision: number } | { doc: null; revision: null }) & {
  outcomeUnknown?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/* ── The owner ─────────────────────────────────────────────────────────────── */

export function createRouteOwner(route: string, registry: AtomRegistry.AtomRegistry) {
  const inspector = inspectAtomRegistry(registry);
  const id = `${route}/${crypto.randomUUID()}`;
  const releases: Array<() => void> = [];
  let busyTimer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let disposed = false;

  const keep = <A extends Atom.Atom<any>>(atom: A): A => {
    const kept = atom.pipe(Atom.autoDispose);
    releases.push(registry.mount(kept));
    return kept;
  };
  /** Labels and mounts an atom. `AtomRegistry.mount` reads eagerly (`AtomRegistry.ts:537`). */
  function owned<A extends Atom.Atom<any>>(label: string, atom: A): A;
  function owned(label: string): <A extends Atom.Atom<any>>(atom: A) => A;
  function owned<A extends Atom.Atom<any>>(label: string, atom?: A) {
    const own = <T extends Atom.Atom<any>>(value: T): T =>
      keep(value.pipe(Atom.withLabel(`${route}/${label}`)));
    return atom ? own(atom) : own;
  }
  const write = <A>(action: string, key: string, mutate: () => A): A => {
    const result = mutate();
    inspector.recordLocalCall(id, { verb: action, key });
    return result;
  };

  const runtime = keep(Atom.runtime(Layer.empty));
  Reflect.set(runtime.layer, "keepAlive", false);
  const invalidate = keep(runtime.fn((keys: readonly string[]) => Reactivity.invalidate(keys)));

  const busy = owned("action/busy", Atom.make<{ key: string; seconds: number } | null>(null));
  const failure = owned("action/failure", Atom.make<Refusal | null>(null));

  /** Busy is a RUNTIME refusal (ruling Q4): one action at a time, and the second one is told so. */
  const runAction = async (
    key: string,
    work: () => Promise<Refusal | null>,
    keys?: readonly string[],
  ): Promise<Refusal | null> => {
    if (inFlight) {
      const refusal = refuse("busy", `${key} refused; another action is running`);
      write(key, "failure", () => registry.set(failure, refusal));
      return refusal;
    }
    inFlight = true;
    write(key, "failure", () => registry.set(failure, null));
    write(key, "busy", () => registry.set(busy, { key, seconds: 0 }));
    const started = Date.now();
    busyTimer = setInterval(
      () =>
        write(key, "busy", () =>
          registry.set(busy, { key, seconds: Math.floor((Date.now() - started) / 1000) }),
        ),
      250,
    );
    try {
      const refusal = await work();
      if (refusal) write(key, "failure", () => registry.set(failure, refusal));
      return refusal;
    } catch (cause) {
      const refusal = causeRefusal(cause);
      write(key, "failure", () => registry.set(failure, refusal));
      return refusal;
    } finally {
      if (keys?.length)
        write(key, `invalidate/${keys.join(",")}`, () => registry.set(invalidate, keys));
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = undefined;
      inFlight = false;
      write(key, "busy", () => registry.set(busy, null));
    }
  };

  return {
    registry,
    id,
    expose(references: OwnerReferences) {
      const release = inspector.expose(id, references);
      const nodes = [
        ...new Set(Object.values(references).flatMap((entries) => Object.values(entries))),
      ].flatMap((atom) => {
        const node = registry.getNodes().get(atom);
        // Owner-mounted outputs are already active. Watching them adds no producer reads.
        return node && node.listeners.size > 0 ? [node] : [];
      });
      const onPublication = () => inspector.notify();
      for (const node of nodes) node.listeners.add(onPublication);
      releases.push(() => {
        for (const node of nodes) node.listeners.delete(onPublication);
        release();
      });
    },
    owned,
    /** Mount an existing shared family without cloning its identity or disposal policy. */
    shared<A extends Atom.Atom<any>>(atom: A): A {
      releases.push(registry.mount(atom));
      return atom;
    },
    write,
    runAction,
    busy,
    failure,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (busyTimer) clearInterval(busyTimer);
      for (const release of releases.splice(0).reverse()) release();
    },
  };
}

export type RouteOwner = ReturnType<typeof createRouteOwner>;

/** Mount an owner for the life of a component; StrictMode's double-mount disposes once. */
export function useRouteOwner<T extends { dispose(): void; registry: AtomRegistry.AtomRegistry }>(
  create: () => T,
): T {
  const storeRef = useRef<T | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  storeRef.current ??= create();
  const store = storeRef.current;
  useEffect(() => {
    if (disposeTimer.current) clearTimeout(disposeTimer.current);
    return () => {
      disposeTimer.current = setTimeout(() => store.dispose(), 0);
    };
  }, [store]);
  return store;
}

/**
 * The search a standalone route carries: `?target=<Address>` for document-scoped Work and
 * `?work=<id>` for a standalone workspace. `?doc=`/`?pin=` are gone — Work keys by Address and a
 * session is never pinned by SDK label (law 6).
 */
export function routeSearch(search: Record<string, unknown>): { target?: string; work?: string } {
  const target = addressSchema.safeParse(search.target).data;
  const work = typeof search.work === "string" ? search.work.trim() : "";
  return { ...(target ? { target } : {}), ...(work ? { work } : {}) };
}

/* ── Work ──────────────────────────────────────────────────────────────────── */

class RouteAtomKey implements Equal.Equal {
  constructor(
    readonly spec: RouteStateSpec<any>,
    readonly key: WorkKey,
    readonly resources: Readings,
  ) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return (
      that instanceof RouteAtomKey &&
      this.spec.route === that.spec.route &&
      this.resources === that.resources &&
      workKey(this.key) === workKey(that.key)
    );
  }
  [Hash.symbol]() {
    return Hash.string(`${this.spec.route}\0${workKey(this.key)}`);
  }
}

function routeUrl(route: string, operation: "apply" | "command", key: WorkKey) {
  const url = new URL(peUrl(resolveWorkbenchConfig(), `/route-state/${route}/${operation}`));
  if (key.work !== undefined) url.searchParams.set("work", key.work);
  else if (key.target !== null) url.searchParams.set("target", key.target);
  return url.toString();
}

const routeAtom = Atom.family((key: RouteAtomKey) => {
  const { spec } = key;
  const resource = readingAtom({ ...key.key, kind: "work" }, key.resources);
  return Atom.make((get) => {
    const result = get(resource);
    try {
      return readingMap(result, (raw): Slice<RouteDocOf<typeof spec>> => {
        if (raw === null) return { doc: null, revision: null };
        if (!isRecord(raw) || !Number.isInteger(raw.revision) || !("doc" in raw))
          throw Error("Work response has no document or revision");
        return {
          doc: parseRouteDoc(raw.doc, spec),
          revision: raw.revision as number,
          outcomeUnknown: Boolean(raw.outcomeUnknown),
        };
      });
    } catch (error) {
      const self = Option.getOrUndefined(get.self<Reading<Slice<RouteDocOf<typeof spec>>>>());
      const previous = self ? previousOf(self) : undefined;
      const failed: Reading<Slice<RouteDocOf<typeof spec>>> = {
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
        ...(previous !== undefined && { previous }),
      };
      return failed;
    }
  }).pipe(Atom.withLabel(`${spec.route}/slice`));
});

export function docAtom<S extends RouteStateSpec<any>>(
  spec: S,
  key: WorkKey,
  resources: Readings = peReadings,
): Atom.Atom<Reading<Slice<RouteDocOf<S>>>> {
  return routeAtom(new RouteAtomKey(spec, key, resources));
}

const notHydrated = refuse("not-ready", "route document is not hydrated");

export function docWriter<S extends RouteStateSpec<any>>(
  spec: S,
  key: WorkKey,
  registry: AtomRegistry.AtomRegistry,
  slice: Atom.Atom<Reading<Slice<RouteDocOf<S>>>>,
) {
  const send = async (
    operation: "apply" | "command",
    body: Record<string, unknown>,
  ): Promise<Refusal | null> => {
    try {
      const response = await fetch(routeUrl(spec.route, operation, key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as RouteStateWriteResult | null;
      if (!result) return refuse("failed", `${operation} failed (${response.status})`);
      if (!result.ok && result.code === "stale_revision") registry.set(routeConflictAtom, true);
      return writeRefusal(result);
    } catch (cause) {
      return causeRefusal(cause);
    }
  };
  const pendingRequestIds = new Map<string, string>();
  const writeRevision = (explicit?: number): number | null => {
    // An explicit revision is the caller's own declaration and the server arbitrates it: a queued
    // apply carries the revision its predecessor just landed, which the owner has not observed yet.
    if (explicit !== undefined) return explicit;
    const current = registry.get(slice);
    if (current.state !== "ready") return null;
    // Only an explicit authored write can initialize absent Work. Observation never creates it.
    return current.observation.revision ?? 0;
  };
  return {
    apply: (patches: RouteStatePatch[], expectedRevision?: number) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return Promise.resolve(notHydrated);
      return send("apply", { patches, expectedRevision: revision });
    },
    command: async (
      name: keyof S["commands"] & string,
      input?: unknown,
      expectedRevision?: number,
    ) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return notHydrated;
      // One request id per (command, input) until it lands: a re-click after a lost response
      // replays the receipt instead of mutating Revit twice.
      const gesture = JSON.stringify([name, input ?? {}]);
      const requestId =
        spec.commands[name]?.mutatesExternal === true
          ? (pendingRequestIds.get(gesture) ?? crypto.randomUUID())
          : undefined;
      if (requestId) pendingRequestIds.set(gesture, requestId);
      const refusal = await send("command", {
        command: name,
        input: input ?? {},
        expectedRevision: revision,
        ...(requestId ? { requestId } : {}),
      });
      if (!refusal) pendingRequestIds.delete(gesture);
      return refusal;
    },
  };
}

/* ── The hook ──────────────────────────────────────────────────────────────── */

export interface ActionHandle {
  readonly label: string;
  readonly says: string;
  readonly chord?: string;
  /** The manifest's `ready()` sentence; null = runnable. */
  readonly refusal: string | null;
  readonly run: (input?: unknown) => Promise<Refusal | null>;
}

/** What the last run of an action left behind: the action, and its refusal or nothing. */
export interface RouteOutcome<A extends string> {
  readonly key: A;
  readonly label: string;
  readonly refusal: Refusal | null;
}

export interface RouteHandle<W, R extends string, P, A extends string> {
  readonly manifest: RouteManifest<W, R, P, A>;
  readonly resolution: TargetResolution;
  /** The `?target` the visitor chose (`<session>` or `<session>/<openId>`); null = inferred from the thread head. */
  readonly chosen: string | null;
  readonly work: {
    readonly doc: W | null;
    readonly revision: number | null;
    readonly write: (patch: RouteStatePatch[]) => Promise<Refusal | null>;
    readonly conflict: boolean;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  readonly page: readonly [P, (next: Partial<P>) => void];
  readonly actions: Readonly<Record<A, ActionHandle>>;
  readonly busy: { readonly key: A; readonly seconds: number } | null;
  readonly failure: Refusal | null;
  readonly outcome: RouteOutcome<A> | null;
  readonly demo: boolean;
}

/**
 * Fold 2 runs the manifest against the live `peReadings` stream. Routes have NOT been cut over to
 * manifests yet (that is fold 5), so today every caller passes an empty or near-empty manifest and
 * the handle is mostly `absent`. The shape is the contract; the wiring deepens in fold 3.
 */
/**
 * `?target` grammar: a document Address (path or cloud GUID) names the document in whichever
 * session holds it open; anything else is a session key and names that session's one open document.
 */
export function parseTarget(
  target: string | null | undefined,
): { kind: "address"; address: Address } | { kind: "session"; session: string } | null {
  if (!target) return null;
  const parsed = addressSchema.safeParse(target);
  return parsed.success
    ? { kind: "address", address: parsed.data }
    : { kind: "session", session: target };
}

export function useRoute<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
  options: { target?: string | null; work?: string } = {},
): RouteHandle<W, R, P, A> {
  const owner = useRouteOwner(() => createRouteOwner(manifest.key, appAtomRegistry));
  const demo = useMemo(
    () =>
      typeof location === "undefined" ? null : new URLSearchParams(location.search).get("demo"),
    [],
  );
  const seed = demo ? manifest.seeds?.[demo as A] : undefined;
  const [page, setPageState] = useState<P>(() => ({ ...seed?.page }) as P);
  const [outcome, setOutcome] = useState<RouteOutcome<A> | null>(null);
  // Busy and failure live in the OWNER, which is what `runAction` writes and what refuses a second
  // action. Holding a second copy in render state is how the button and the chord drifted apart:
  // the chord's refusal painted and the button's did not. One atom each, read here.
  const busy = useOwned(owner.registry, owner.busy) as { key: A; seconds: number } | null;
  const failure = useOwned(owner.registry, owner.failure);
  const { target = null, work } = options;
  const spec = manifest.work;

  const inventory = useMemo(() => readingAtom({ kind: "inventory" }, peReadings), []);
  const inventoryResult = useOwned(owner.registry, inventory) as Reading<unknown>;
  const conflictNow = useOwned(owner.registry, routeConflictAtom) ?? false;
  /**
   * The route's default Target is whatever the thread head says. A route that declares a
   * `thread-head` Reading resolves against it; one that does not has no default and refuses until
   * a document is chosen. No component keeps a second copy (fable law 6).
   */
  const headRequest = useMemo(
    () =>
      Object.values(manifest.readings ?? {}).find(
        (request) => (request as ReadingRequest).kind === "thread-head",
      ) as ReadingRequest | undefined,
    [manifest.readings],
  );
  const headAtom = useMemo(
    () => (headRequest ? readingAtom(headRequest, peReadings) : null),
    [headRequest],
  );
  const headResult = useOwned(owner.registry, headAtom) as Reading<unknown> | null;
  const defaultDocument = useMemo(
    () =>
      threadHeadSchema.safeParse(headResult ? previousOf(headResult) : undefined).data
        ?.defaultTarget ?? null,
    [headResult],
  );
  const resolution: TargetResolution = useMemo(() => {
    // The demo lane resolves by construction: a seed is the moment, so its own action is runnable.
    if (seed) return { kind: "resolved", target: { kind: "host" } as ExecutionTarget };
    if (!manifest.needs) return { kind: "resolved", target: { kind: "host" } as ExecutionTarget };
    if (inventoryResult.state !== "ready") return { kind: "checking" };
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);

    // A chosen `?target` beats the thread head; see `parseTarget` for the grammar.
    const chosen = parseTarget(target);
    let request: DocumentRequest | null = defaultDocument;
    if (chosen && inventory.kind === "ready") {
      if (chosen.kind === "session") {
        const found = inventory.sessions[chosen.session];
        if (!found) return { kind: "choose", reason: "session-gone" };
        if (found.kind !== "ready") return found;
        if (found.values.length === 0) return { kind: "choose", reason: "document-closed" };
        if (found.values.length > 1) return { kind: "choose", reason: "ambiguous" };
        request = {
          kind: "open",
          ref: { session: chosen.session, openId: found.values[0]!.openId },
        };
      } else {
        const holders = Object.entries(inventory.sessions).filter(
          ([, found]) =>
            found.kind === "ready" &&
            found.values.some(
              (doc) => doc.address !== null && sameAddress(doc.address, chosen.address),
            ),
        );
        if (holders.length === 0) return { kind: "choose", reason: "document-closed" };
        if (holders.length > 1) return { kind: "choose", reason: "ambiguous" };
        request = { kind: "named", session: holders[0]![0], address: chosen.address };
      }
    }
    const session = request?.kind === "open" ? request.ref.session : request?.session;
    const needs =
      manifest.needs === "session"
        ? ({ needs: "session", target: session ?? "" } as const)
        : ({
            needs:
              manifest.needs === "family"
                ? ("family-document" as const)
                : manifest.needs === "project"
                  ? ("project-document" as const)
                  : ("document" as const),
          } as const);
    if (needs.needs === "session" && !needs.target) return { kind: "choose", reason: "missing" };
    return resolveCallTarget(needs as never, request, inventory);
  }, [seed, manifest.needs, inventoryResult, defaultDocument, target]);

  // The Work key is the resolved document's Address, so a session-key `?target` and an Address
  // `?target` for the same document read and write the same Work.
  const resolvedAddress = useMemo((): Address | null => {
    if (resolution.kind !== "resolved" || resolution.target.kind !== "document") return null;
    if (inventoryResult.state !== "ready") return null;
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);
    const found =
      inventory.kind === "ready" ? inventory.sessions[resolution.target.ref.session] : undefined;
    const ref = resolution.target.ref;
    return found?.kind === "ready"
      ? (found.values.find((doc) => doc.openId === ref.openId)?.address ?? null)
      : null;
  }, [resolution, inventoryResult]);
  const key: WorkKey = useMemo(
    () => ({
      route: manifest.key,
      target: resolvedAddress,
      ...(work !== undefined ? { work } : {}),
    }),
    [manifest.key, resolvedAddress, work],
  );
  const slice = useMemo(() => (spec ? docAtom(spec, key, peReadings) : null), [spec, key]);
  const sliceResult = useOwned(owner.registry, slice);
  // A seed IS the Work in the demo lane; nothing is fetched and nothing is written through.
  const doc: Slice<W> | null = seed
    ? { doc: seed.work as W, revision: 0 }
    : sliceResult && sliceResult.state === "ready"
      ? (sliceResult.observation as Slice<W>)
      : null;

  // Every declared Reading is one subject on the one stream — EXCEPT in the demo lane, where the
  // seed is the whole observation and nothing is asked of the host. Subscribing anyway also
  // VALIDATED the request, and a manifest may only be able to name its subject once a Target is
  // bound (takeoff/manifest.ts:116 carries `{ session: "", openId: "" }` until then), so the demo
  // lane threw on mount before it could draw a single seeded row.
  // The live lane binds the resolved document into every placeholder target and leaves those
  // Readings `absent` until the route resolves — the same request is never sent unbound.
  const boundDocument =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const boundKey = JSON.stringify(boundDocument);
  const readingAtoms = useMemo(() => {
    const bound = JSON.parse(boundKey) as { session: string; openId: string } | null;
    return seed
      ? []
      : Object.entries(manifest.readings ?? {}).flatMap(([name, request]) => {
          const r = request as ReadingRequest & { target?: { session?: string } };
          const placeholder = r.target !== undefined && r.target.session === "";
          if (placeholder && !bound) return [];
          const req = placeholder ? { ...r, target: bound } : r;
          return [[name, readingAtom(req as ReadingRequest, peReadings)] as const];
        });
  }, [manifest.readings, seed, boundKey]);
  const readingsAtom = useMemo(
    () =>
      Atom.make((get) => ({
        ...Object.fromEntries(
          Object.keys(manifest.readings ?? {}).map((name) => [name, { state: "absent" }]),
        ),
        ...Object.fromEntries(readingAtoms.map(([name, atom]) => [name, get(atom)])),
      })),
    [manifest.readings, readingAtoms],
  );
  const liveReadings = useOwned(owner.registry, readingsAtom) as Record<string, Reading<unknown>>;
  const readings = (
    seed
      ? Object.fromEntries(
          Object.keys(manifest.readings ?? {}).map((name) => {
            const sown = seed.readings[name as R];
            return [
              name,
              sown === undefined
                ? ({ state: "absent" } satisfies Reading<unknown>)
                : ({ state: "ready", observation: sown } satisfies Reading<unknown>),
            ];
          }),
        )
      : liveReadings
  ) as Record<R, Reading<unknown>>;

  const writer = useMemo(
    () => (spec && slice ? docWriter(spec, key, owner.registry, slice) : null),
    [spec, slice, key, owner],
  );

  const setPage = (next: Partial<P>) => setPageState((current) => ({ ...current, ...next }));

  const actions = useMemo(() => {
    const noTarget =
      manifest.needs && resolution.kind !== "resolved"
        ? resolution.kind === "checking"
          ? "checking the target"
          : `pick a ${manifest.needs}`
        : null;
    const ctx = {
      target: resolution.kind === "resolved" ? resolution.target : ({ kind: "host" } as const),
      work: { doc: (doc?.doc ?? null) as W, revision: doc?.revision ?? 0 },
      readings,
      page,
      call: (operation: string, input?: unknown) =>
        // The demo lane is deterministic by construction: a seed names no live Target, so a call
        // records what was asked and answers, rather than reaching a host that is not this moment.
        seed
          ? Promise.resolve({ demo: true, operation, input: input ?? null })
          : callHostDynamic(operation, input, targetHeaders(ctx.target)),
      write: async (patches: RouteStatePatch[]) => {
        if (seed) return;
        await writer?.apply(patches);
      },
      command: async (name: string, input?: unknown) => {
        // Same law as `write`: under a seed the document IS the moment, so a command records
        // nothing and refuses nothing.
        if (seed) return;
        const refusal = await writer?.command(name as never, input);
        if (refusal) throw new Error(refusal.message);
      },
      external: async <T>(run: () => Promise<T>) => (seed ? null : run()),
      setPage,
    };
    return Object.fromEntries(
      Object.entries(manifest.actions ?? {}).map((entry) => {
        const name = entry[0] as A;
        const action = entry[1] as NonNullable<typeof manifest.actions>[A];
        const handle: ActionHandle = {
          label: action.label,
          says: action.says,
          ...(action.chord ? { chord: String(action.chord) } : {}),
          refusal: noTarget ?? action.ready(ctx as never, undefined as never),
          run: async (input?: unknown) => {
            const refusal = await owner.runAction(name, async () => {
              if (noTarget) return refuse("no-target", noTarget);
              const reason = action.ready(ctx as never, input as never);
              if (reason) return refuse("not-ready", reason);
              // A seed may inject the failure its moment is about; the action never runs.
              if (seed?.failure?.action === name) return refuse("failed", seed.failure.message);
              await action.run(ctx as never, input as never);
              return null;
            });
            setOutcome({ key: name, label: action.label, refusal });
            return refusal;
          },
        };
        return [name, handle];
      }),
    ) as Record<A, ActionHandle>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, resolution, readings, page, doc, writer, owner, seed]);

  return {
    manifest,
    resolution,
    chosen: target,
    work: {
      doc: (doc?.doc ?? null) as W | null,
      revision: doc?.revision ?? null,
      write: async (patches: RouteStatePatch[]) => (await writer?.apply(patches)) ?? notHydrated,
      conflict: conflictNow,
    },
    readings,
    page: [page, setPage] as const,
    actions,
    busy,
    failure,
    outcome,
    demo: seed !== undefined,
  };
}
