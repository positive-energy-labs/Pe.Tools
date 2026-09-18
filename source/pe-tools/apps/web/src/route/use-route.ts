/**
 * `useRoute(manifest)` — the one owner. It replaces `state/route-store.ts`, `state/registry.ts`,
 * `state/use-route-store.ts` and `targeting/actions.ts`: a route hands it a manifest and gets back
 * a resolution, its Work, its Readings, its Page, and one handle per action. Public handles return
 * structured Refusals (`route/refusal.ts`).
 */
import { frozenDemo } from "#/host/demo-client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addressSchema,
  documentRequestSchema,
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

import {
  dirty,
  readingAtom,
  peReadings,
  previousOf,
  targetInventory,
  type Readings,
} from "#/readings";
import { inspectAtomRegistry, type OwnerReferences } from "#/state/atom-inspect";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";
import type { RouteManifest } from "./manifest";
import { callHostDynamic } from "#/host/client";
import { causeRefusal, refuse, writeRefusal, type Refusal } from "./refusal";
import { postRouteWrite } from "./host";
import { useThreadScope } from "#/chat/scope";
import { cancelRunningAdmissions } from "../../../../packages/mcps/src/shared/takeoff-action-client";

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

/** A render subscribed to one atom in the owner's registry; `null` atom reads as `null`. */
function useOwned<A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A> | null): A | null {
  const subscribe = useMemo(
    () => (notify: () => void) => (atom ? registry.subscribe(atom, notify) : () => {}),
    [registry, atom],
  );
  return useSyncExternalStore(subscribe, () => (atom ? registry.get(atom) : null));
}

export type Slice<D> = { doc: D; revision: number } | { doc: null; revision: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Internal unwind only; the public action boundary still returns the structured refusal. */
class ActionRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}

const refusalOf = (cause: unknown) =>
  cause instanceof ActionRefusal ? cause.refusal : causeRefusal(cause);

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
  const conflict = owned("work/conflict", Atom.make(false));
  // The page log: one per route, newest first. Every verb run, refusal and target change lands
  // here, so no widget keeps its own activity list (Situation, 2026-09-13).
  const log = owned("log", Atom.make<readonly LogEntry[]>([]));
  const note = (kind: LogEntry["kind"], label: string, says: string, refused = false) =>
    registry.set(log, [
      { at: new Date().toLocaleTimeString([], { hour12: false }), kind, label, says, refused },
      ...registry.get(log).slice(0, 199),
    ]);

  let stopper: (() => void) | null = null;

  /**
   * Busy is a RUNTIME refusal (ruling Q4): one action at a time, and the second one is told so.
   * `onStopped` fires instead of a result when the wait was stopped from the flag.
   */
  const runAction = async (
    key: string,
    work: () => Promise<Refusal | null>,
    keys?: readonly string[],
    onStopped?: () => void,
    /** The word on the button. The log says what the user pressed, never the action key. */
    label = key,
  ): Promise<Refusal | null> => {
    if (inFlight) {
      const refusal = refuse("busy", `${key} refused; another action is running`);
      write(key, "failure", () => registry.set(failure, refusal));
      return refusal;
    }
    inFlight = true;
    write(key, "busy", () => registry.set(busy, { key, seconds: 0 }));
    const started = Date.now();
    busyTimer = setInterval(
      () =>
        write(key, "busy", () =>
          registry.set(busy, { key, seconds: Math.floor((Date.now() - started) / 1000) }),
        ),
      250,
    );
    const invalidateKeys = () => {
      if (keys?.length)
        write(key, `invalidate/${keys.join(",")}`, () => registry.set(invalidate, keys));
    };
    let detached = false;
    const finish = () => {
      stopper = null;
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = undefined;
      inFlight = false;
      if (!disposed) write(key, "busy", () => registry.set(busy, null));
    };
    // The stop reaches the RUNNING OP: the host sends `op.cancel` outside its per-session gate,
    // so Revit stops at the operation's next checkpoint and the row settles `cancelled`. The wait
    // is released only once the host said yes; a refusal leaves the op running and says why.
    // A late result still lands as its own row.
    const stopped = new Promise<"stopped">((resolve) => {
      stopper = () => {
        void cancelRunningAdmissions().then((settled) => {
          const refused = settled.flatMap((one) =>
            one.status === "rejected"
              ? [one.reason instanceof Error ? one.reason.message : String(one.reason)]
              : [],
          );
          if (!settled.length)
            refused.push("Nothing this page started is running on the host yet.");
          if (refused.length) note("verb", label, `stop refused · ${refused.join(" ")}`, true);
          else resolve("stopped");
        });
      };
    });
    try {
      const running = work();
      const result = await Promise.race([running, stopped]);
      if (result === "stopped") {
        note(
          "verb",
          label,
          "stopped · cancel signalled; the op stops at its next checkpoint",
          true,
        );
        const late = (says: string, refusal: Refusal | null) => {
          if (disposed) return;
          write(key, "failure", () => registry.set(failure, refusal));
          note("verb", label, `late · ${says}`, Boolean(refusal));
          if (!refusal) invalidateKeys();
        };
        running
          .then((result) => late(result ? `refused · ${result.message}` : "ran", result))
          .catch((cause: unknown) => {
            const refusal = refusalOf(cause);
            late(`failed · ${refusal.message}`, refusal);
          })
          .finally(finish);
        detached = true;
        onStopped?.();
        return null;
      }
      write(key, "failure", () => registry.set(failure, result));
      note("verb", label, result ? `refused · ${result.message}` : "ran", Boolean(result));
      if (!result) invalidateKeys();
      return result;
    } catch (cause) {
      const refusal = refusalOf(cause);
      write(key, "failure", () => registry.set(failure, refusal));
      note("verb", label, `failed · ${refusal.message}`, true);
      return refusal;
    } finally {
      if (!detached) finish();
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
    /** Stop the running action: signal the host, then release the wait. No-op when nothing runs. */
    stop: () => stopper?.(),
    busy,
    failure,
    conflict,
    log,
    note,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (busyTimer) clearInterval(busyTimer);
      for (const release of releases.splice(0).reverse()) release();
    },
  };
}

export type RouteOwner = ReturnType<typeof createRouteOwner>;

/** One page-log line. `refused` draws the caution hue; the text is the whole reason. */
export interface LogEntry {
  readonly at: string;
  readonly kind: "verb" | "target" | "stage" | "work";
  readonly label: string;
  readonly says: string;
  readonly refused: boolean;
}

/** Mount an owner for the life of a component; StrictMode's double-mount disposes once. */
export function useRouteOwner<T extends { dispose(): void; registry: AtomRegistry.AtomRegistry }>(
  create: () => T,
  identity?: unknown,
): T {
  const storeRef = useRef<T | null>(null);
  const identityRef = useRef(identity);
  const retiredRef = useRef<T[]>([]);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (storeRef.current === null || !Object.is(identityRef.current, identity)) {
    if (storeRef.current !== null) retiredRef.current.push(storeRef.current);
    storeRef.current = create();
    identityRef.current = identity;
  }
  const store = storeRef.current;
  useEffect(() => {
    if (disposeTimer.current) clearTimeout(disposeTimer.current);
    for (const retired of retiredRef.current.splice(0)) retired.dispose();
    return () => {
      disposeTimer.current = setTimeout(() => store.dispose(), 0);
    };
  }, [store]);
  return store;
}

/**
 * Route search preserves the target string; parseTarget validates its exact request or shorthand.
 * `thread` names the thread whose head is the route's target store; the root retains it on every
 * link, so the URL carries the thread.
 */
export function routeSearch(search: Record<string, unknown>): {
  target?: string;
  work?: string;
  thread?: string;
} {
  // The router JSON-parses search values, so an exact `?target={"kind":"open",...}` arrives as an
  // object. It is re-serialized here so `parseTarget` always reads the one string grammar; left as
  // an object it threw in render, and the SSR stream hung on the throw instead of finishing.
  const raw = search.target;
  const target =
    typeof raw === "string"
      ? raw.trim()
      : raw !== null && typeof raw === "object"
        ? JSON.stringify(raw)
        : "";
  const work = typeof search.work === "string" ? search.work.trim() : "";
  const thread = typeof search.thread === "string" ? search.thread.trim() : "";
  return {
    ...(target ? { target } : {}),
    ...(work ? { work } : {}),
    ...(thread ? { thread } : {}),
  };
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

function docAtom<S extends RouteStateSpec<any>>(
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
  conflict: Atom.Writable<boolean> | undefined,
) {
  const send = async (
    operation: "apply" | "command",
    body: Record<string, unknown>,
    onAccepted?: (revision: number) => void,
  ): Promise<Refusal | null> => {
    try {
      const { status, result } = await postRouteWrite(routeUrl(spec.route, operation, key), body);
      if (!result) return refuse("failed", `${operation} failed (${status})`);
      if (!result.ok && result.code === "stale_revision" && conflict) registry.set(conflict, true);
      if (result.ok) onAccepted?.(result.revision);
      return writeRefusal(result);
    } catch (cause) {
      return causeRefusal(cause);
    }
  };
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
    apply: (
      patches: RouteStatePatch[],
      expectedRevision?: number,
      onAccepted?: (revision: number) => void,
    ) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return Promise.resolve(notHydrated);
      return send("apply", { patches, expectedRevision: revision }, onAccepted);
    },
    command: (
      name: keyof S["commands"] & string,
      input?: unknown,
      expectedRevision?: number,
      onAccepted?: (revision: number) => void,
    ) => {
      const revision = writeRevision(expectedRevision);
      return revision === null
        ? Promise.resolve(notHydrated)
        : send(
            "command",
            { command: name, input: input ?? {}, expectedRevision: revision },
            onAccepted,
          );
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
  readonly stage?: string;
  /** Page state the verb carries ("Partition 10"); null = none. */
  readonly count: number | null;
  readonly run: (input?: unknown) => Promise<Refusal | null>;
}

/** What the last run of an action left behind: the action, and its refusal or nothing. */
export interface RouteOutcome<A extends string> {
  readonly key: A;
  readonly label: string;
  readonly refusal: Refusal | null;
  /** The wait was stopped from the flag; the host call itself was not cancelled. */
  readonly stopped: boolean;
  /** When it landed; a flag dismissed once stays dismissed for this outcome. */
  readonly at: number;
}

export interface RouteHandle<W, R extends string, P, A extends string> {
  readonly manifest: RouteManifest<W, R, P, A>;
  readonly resolution: TargetResolution;
  /** The `?target` pin: a view over one document, never written by the route; null reads the head. */
  readonly chosen: string | null;
  /** The thread head, the one target store; null on a route that names no thread. */
  readonly head: {
    readonly thread: string;
    /** Move the thread's target; the head refuses when stale or while a turn holds it. */
    readonly set: ReturnType<typeof useThreadScope>["set"];
    readonly refusal: string | null;
  } | null;
  readonly work: {
    readonly key: WorkKey;
    readonly doc: W | null;
    readonly revision: number | null;
    /** Whether the authoritative Work reading is current, including a current absent document. */
    readonly current: boolean;
    readonly write: (
      patches: RouteStatePatch[],
      expectedRevision?: number,
    ) => Promise<Refusal | null>;
    /** Another writer landed first; the last write was refused. `reload` reads Work again. */
    readonly conflict: boolean;
    readonly reload: () => void;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  /** The bridge inventory the resolution reads; a seed's `inventory` reading when seeded. */
  readonly inventory: Reading<unknown>;
  readonly page: readonly [P, (next: Partial<P>) => void];
  readonly actions: Readonly<Record<A, ActionHandle>>;
  readonly busy: { readonly key: A; readonly seconds: number } | null;
  /** Stop waiting on the busy action (its flag's stop). */
  readonly stop: () => void;
  readonly failure: Refusal | null;
  readonly outcome: RouteOutcome<A> | null;
  /** The page log, newest first. */
  readonly log: readonly LogEntry[];
  readonly demo: boolean;
}

/**
 * `?target` accepts a schema-validated JSON DocumentRequest for exact picker selections.
 * A document Address (path or cloud GUID) names the document in whichever
 * session holds it open; anything else is a session key and names that session's one open document.
 */
export function parseTarget(
  target: string | null | undefined,
):
  | { kind: "address"; address: Address }
  | { kind: "session"; session: string }
  | { kind: "request"; request: DocumentRequest }
  | null {
  if (!target) return null;
  if (target.startsWith("{")) {
    try {
      const request = documentRequestSchema.safeParse(JSON.parse(target));
      return request.success
        ? { kind: "request", request: request.data }
        : { kind: "session", session: target };
    } catch {
      return { kind: "session", session: target };
    }
  }
  const parsed = addressSchema.safeParse(target);
  return parsed.success
    ? { kind: "address", address: parsed.data }
    : { kind: "session", session: target };
}

export function useRoute<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
  options: {
    target?: string | null | ((page: P) => string | null);
    work?: string | ((page: P, target: Address | null) => string | undefined);
    page?: Partial<P>;
    provided?: Partial<Record<R, Reading<unknown>>>;
    /** The thread whose head is this route's default target. */
    thread?: string;
  } = {},
): RouteHandle<W, R, P, A> {
  const demo = useMemo(frozenDemo, []);
  const seed = demo ? manifest.seeds?.[demo as A] : undefined;
  const owner = useRouteOwner(() =>
    createRouteOwner(
      manifest.key,
      seed ? makeAtomRegistry({ defaultIdleTTL: 400 }) : appAtomRegistry,
    ),
  );
  const [page, setPageState] = useState<P>(() => {
    const initial = { ...seed?.page, ...options.page };
    return manifest.page ? manifest.page.parse(initial) : (initial as P);
  });
  const [outcome, setOutcome] = useState<RouteOutcome<A> | null>(null);
  // Busy and failure live in the OWNER, which is what `runAction` writes and what refuses a second
  // action. Holding a second copy in render state is how the button and the chord drifted apart:
  // the chord's refusal painted and the button's did not. One atom each, read here.
  const busy = useOwned(owner.registry, owner.busy) as { key: A; seconds: number } | null;
  const failure = useOwned(owner.registry, owner.failure);
  const log = useOwned(owner.registry, owner.log) ?? [];
  const { target: requestedTarget = null, work: requestedWork, provided } = options;
  const target = typeof requestedTarget === "function" ? requestedTarget(page) : requestedTarget;
  const spec = manifest.work;
  const inventory = useMemo(
    () => (seed ? null : readingAtom({ kind: "inventory" }, peReadings)),
    [seed],
  );
  const inventoryResult = (useOwned(owner.registry, inventory) ?? {
    state: "absent",
  }) as Reading<unknown>;
  const conflictNow = useOwned(owner.registry, owner.conflict) ?? false;
  /**
   * The route's default Target is whatever the thread head says. A route that declares a
   * `thread-head` Reading resolves against it; one that does not has no default and refuses until
   * a document is chosen. No component keeps a second copy (fable law 6).
   */
  const headRequest = useMemo(
    () =>
      (options.thread
        ? { kind: "thread-head", thread: options.thread }
        : Object.values(manifest.readings ?? {}).find(
            (request) =>
              typeof request !== "function" &&
              (request as ReadingRequest | undefined)?.kind === "thread-head",
          )) as Extract<ReadingRequest, { kind: "thread-head" }> | undefined,
    [manifest.readings, options.thread],
  );
  const headAtom = useMemo(
    () => (!seed && headRequest ? readingAtom(headRequest, peReadings) : null),
    [headRequest, seed],
  );
  const headResult = useOwned(owner.registry, headAtom) as Reading<unknown> | null;
  const scope = useThreadScope(
    headRequest?.thread ?? "",
    headResult !== null,
    headResult ?? { state: "absent" },
  );
  const defaultDocument = useMemo(
    () =>
      threadHeadSchema.safeParse(headResult ? previousOf(headResult) : undefined).data
        ?.defaultTarget ?? null,
    [headResult],
  );
  const resolution: TargetResolution = useMemo(() => {
    // A seed's explicit synthetic Target is its authority; host is the backward-safe absence.
    if (seed)
      return {
        kind: "resolved",
        target: seed.target ?? ({ kind: "host" } as ExecutionTarget),
      };
    if (!manifest.needs) return { kind: "resolved", target: { kind: "host" } as ExecutionTarget };
    // Adding a document Reading reconnects the shared stream. Retain the observed target
    // across that gap, or dropping its Readings would trigger another reconnect forever.
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);

    // A chosen `?target` beats the thread head; see `parseTarget` for the grammar.
    const chosen = parseTarget(target);
    let request: DocumentRequest | null = defaultDocument;
    if (chosen && inventory.kind === "ready") {
      if (chosen.kind === "request") {
        request = chosen.request;
      } else if (chosen.kind === "session") {
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
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);
    const found =
      inventory.kind === "ready" ? inventory.sessions[resolution.target.ref.session] : undefined;
    const ref = resolution.target.ref;
    return found?.kind === "ready"
      ? (found.values.find((doc) => doc.openId === ref.openId)?.address ?? null)
      : null;
  }, [resolution, inventoryResult]);
  const work =
    typeof requestedWork === "function" ? requestedWork(page, resolvedAddress) : requestedWork;
  const key: WorkKey = useMemo(
    () => ({
      route: manifest.key,
      target: resolvedAddress,
      ...(work !== undefined ? { work } : {}),
    }),
    [manifest.key, resolvedAddress, work],
  );
  // A target-owned Work declaration cannot fall back to the shared `route/target:` key while its
  // Address is unresolved. Host/file Work and explicit named workspaces intentionally use null.
  const workNeedsTarget = (
    Object.values(manifest.actions ?? {}) as NonNullable<typeof manifest.actions>[A][]
  ).some((action) => action.requires?.work && action.needs !== "host");
  const canReadWork = seed || work !== undefined || resolvedAddress !== null || !workNeedsTarget;
  const slice = useMemo(
    () => (!seed && spec && canReadWork ? docAtom(spec, key, peReadings) : null),
    [seed, spec, canReadWork, key],
  );
  const sliceResult = useOwned(owner.registry, slice);
  // A seed IS the Work in the demo lane; nothing is fetched and nothing is written through.
  // Memoized: `actions` and `work` key on this Slice, and a fresh wrapper per render walked down
  // to the Families `refreshReads` effect as "Maximum update depth exceeded".
  const doc: Slice<W> | null = useMemo(
    () =>
      seed
        ? { doc: seed.work as W, revision: 0 }
        : (((sliceResult ? previousOf(sliceResult) : undefined) as Slice<W> | undefined) ?? null),
    [seed, sliceResult],
  );
  const workCurrent = Boolean(seed || sliceResult?.state === "ready");

  // Every declared Reading is one subject on the one stream — EXCEPT in the demo lane, where the
  // seed is the whole observation and nothing is asked of the host. Subscribing anyway also
  // VALIDATED the request, and a manifest may only be able to name its subject once a Target is
  // bound (takeoff/actions.ts carries `{ session: "", openId: "" }` until then), so the demo
  // lane threw on mount before it could draw a single seeded row.
  // The live lane binds the resolved document into every placeholder target and leaves those
  // Readings `absent` until the route resolves — the same request is never sent unbound.
  const boundDocument =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const boundKey = JSON.stringify(boundDocument);
  const resolvedReadingSpecs = useMemo(
    () =>
      seed
        ? []
        : Object.entries(manifest.readings ?? {})
            .filter(([name]) => !Object.hasOwn(provided ?? {}, name))
            .map(
              ([name, reading]) =>
                [name, typeof reading === "function" ? reading(page, key) : reading] as const,
            ),
    [manifest.readings, page, seed, provided, key],
  );
  const readingAtoms = useMemo(() => {
    const bound = JSON.parse(boundKey) as { session: string; openId: string } | null;
    return resolvedReadingSpecs.flatMap(([name, request]) => {
      if (!request) return [];
      const r = request as ReadingRequest & { target?: { session?: string } };
      const placeholder = r.target !== undefined && r.target.session === "";
      if (placeholder && !bound) return [];
      const req = placeholder ? { ...r, target: bound } : r;
      return [
        [name, readingAtom(req as ReadingRequest, peReadings), req as ReadingRequest] as const,
      ];
    });
  }, [resolvedReadingSpecs, boundKey]);
  const readingsAtom = useMemo(
    () =>
      Atom.make((get) => ({
        ...Object.fromEntries(
          Object.keys(manifest.readings ?? {}).map((name) => [name, { state: "absent" }]),
        ),
        ...Object.fromEntries(readingAtoms.map(([name, atom]) => [name, get(atom)])),
      })).pipe(Atom.withLabel(`${manifest.key}/readings`)),
    [manifest.readings, readingAtoms],
  );
  const liveReadings = useOwned(owner.registry, readingsAtom) as Record<string, Reading<unknown>>;
  // Stable identities: consumers memoize on `readings` and `work`, and a fresh object per render
  // put the Families store's `refreshReads` effect into "Maximum update depth exceeded".
  const seededReadings = useMemo(
    () =>
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
        : null,
    [seed, manifest.readings],
  );
  const providedReadings = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(provided ?? {}).filter(([name]) =>
          Object.hasOwn(manifest.readings ?? {}, name),
        ),
      ),
    [manifest.readings, provided],
  );
  const readings = useMemo(
    () =>
      (seededReadings ?? { ...liveReadings, ...providedReadings }) as Record<R, Reading<unknown>>,
    [seededReadings, liveReadings, providedReadings],
  );

  const writer = useMemo(
    () => (spec && slice ? docWriter(spec, key, owner.registry, slice, owner.conflict) : null),
    [spec, slice, key, owner],
  );
  // Authored patches queue so two same-tick edits carry the first accepted revision into the
  // second write. An explicit revision remains the caller's conflict boundary.
  const writeWork = useMemo(() => {
    let queue: Promise<void> = Promise.resolve();
    let queued = 0;
    let landed: number | null = null;
    return (patches: RouteStatePatch[], expectedRevision?: number): Promise<Refusal | null> => {
      queued += 1;
      let accepted: number | undefined;
      const result = queue
        .then(async () => {
          if (seed) return refuse("not-ready", "frozen seed is read-only");
          return writer
            ? writer.apply(patches, expectedRevision ?? landed ?? undefined, (revision) => {
                accepted = revision;
              })
            : notHydrated;
        })
        .catch(causeRefusal)
        .then((refusal) => {
          if (!refusal && accepted !== undefined) landed = accepted;
          if (refusal) owner.registry.set(owner.failure, refusal);
          queued -= 1;
          if (queued === 0) landed = null;
          return refusal;
        });
      queue = result.then(() => undefined);
      return result;
    };
  }, [writer, owner, seed]);
  // Stable: it is `page[1]`, `ctx.setPage`, and a dep of consumer memos (families/store.ts).
  const pageEpoch = useRef(0);
  const setPage = useCallback((next: Partial<P>) => {
    pageEpoch.current += 1;
    setPageState((current) => ({ ...current, ...next }));
  }, []);
  const scopeKey = JSON.stringify([boundKey, key]);
  const actionScope = useMemo(() => ({}), [scopeKey]);
  const currentActionScope = useRef(actionScope);
  currentActionScope.current = actionScope;

  // Page-log rows for the three events that are not verbs (Situation, 2026-09-13): the target
  // binding, the stage word and the Work revision. Each notes only when its value changes.
  const stage = (page as { stage?: unknown }).stage;
  const stageWord = manifest.stages?.find((item) => item.key === stage)?.word;
  const revision = doc?.revision ?? null;
  const seen = useRef({ target: boundKey, stage: stageWord, revision });
  useEffect(() => {
    if (seen.current.target !== boundKey) {
      seen.current.target = boundKey;
      const bound = JSON.parse(boundKey) as { session: string; openId: string } | null;
      owner.note("target", "target", bound ? `${bound.session} › ${bound.openId}` : "unbound");
    }
    if (seen.current.stage !== stageWord) {
      seen.current.stage = stageWord;
      if (stageWord) owner.note("stage", "stage", stageWord);
    }
    if (seen.current.revision !== revision) {
      seen.current.revision = revision;
      if (revision !== null) owner.note("work", "work", `r${revision} loaded`);
    }
  }, [owner, boundKey, stageWord, revision]);

  const actions = useMemo(() => {
    const targetRefusal = (needs: NonNullable<typeof manifest.needs> | "host") => {
      if (needs === "host") return null;
      if (resolution.kind !== "resolved")
        return resolution.kind === "checking" ? "checking the target" : `pick a ${needs}`;
      if (needs === "session") return resolution.target.kind === "host" ? "pick a session" : null;
      if (resolution.target.kind !== "document") return `pick a ${needs}`;
      if (needs === "document") return null;
      const resolved = resolution.target;
      const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);
      const found =
        inventory.kind === "ready" ? inventory.sessions[resolved.ref.session] : undefined;
      const document =
        found?.kind === "ready"
          ? found.values.find((item) => item.openId === resolved.ref.openId)
          : undefined;
      if (!document) return `pick a ${needs}`;
      return document.kind === (needs === "family" ? "family" : "project")
        ? null
        : `pick a ${needs}`;
    };
    const requirementRefusal = (action: NonNullable<typeof manifest.actions>[A]) => {
      if (seed) return "frozen seed is read-only";
      const target = targetRefusal(action.needs);
      if (target) return target;
      if (action.requires?.work && (!doc || doc.doc === null))
        return "route document is not hydrated";
      if (action.requires?.work && !workCurrent) return "route document is not current";
      const missing = action.requires?.readings?.find((name) => readings[name].state !== "ready");
      return missing === undefined ? null : `${missing} is not ready`;
    };
    // An action's Work is one snapshot. Its late writes must let the host reject that snapshot,
    // not silently borrow a newer revision observed while the action was computing.
    const actionRevision = workCurrent ? (doc?.revision ?? 0) : null;
    const actionPageEpoch = pageEpoch.current;
    const ctx = {
      target: resolution.kind === "resolved" ? resolution.target : ({ kind: "host" } as const),
      work: { key, doc: doc?.doc ?? null, revision: doc?.revision ?? null },
      readings,
      page,
      call: (operation: string, input?: unknown) =>
        callHostDynamic(operation, input, targetHeaders(ctx.target)),
      write: async (patches: RouteStatePatch[]) => {
        const refusal =
          writer && actionRevision !== null
            ? await writer.apply(patches, actionRevision)
            : notHydrated;
        if (refusal) throw new ActionRefusal(refusal);
        return null;
      },
      command: async (name: string, input?: unknown) => {
        const refusal =
          writer && actionRevision !== null
            ? await writer.command(name as never, input, actionRevision)
            : notHydrated;
        if (refusal) throw new ActionRefusal(refusal);
        return null;
      },
      setPage: (next: Partial<P>) => {
        if (currentActionScope.current === actionScope && pageEpoch.current === actionPageEpoch)
          setPageState((current) => ({ ...current, ...next }));
      },
    };
    return Object.fromEntries(
      Object.entries(manifest.actions ?? {}).map((entry) => {
        const name = entry[0] as A;
        const action = entry[1] as NonNullable<typeof manifest.actions>[A];
        const health = requirementRefusal(action);
        const handle: ActionHandle = {
          label: action.label,
          says: action.says,
          ...(typeof action.chord === "string" ? { chord: action.chord } : {}),
          ...(action.stage ? { stage: action.stage } : {}),
          count: health ? null : (action.count?.(ctx as never) ?? null),
          refusal: health ?? action.ready(ctx as never, undefined as never),
          run: async (input?: unknown) => {
            let stopped = false;
            const refusal = await owner.runAction(
              name,
              async () => {
                const target = targetRefusal(action.needs);
                if (target) return refuse("no-target", target);
                const unavailable = requirementRefusal(action);
                if (unavailable) return refuse("not-ready", unavailable);
                const parsed = action.input.safeParse(input);
                if (!parsed.success)
                  return refuse("not-ready", parsed.error.issues[0]?.message ?? "invalid input");
                const reason = action.ready(ctx as never, parsed.data as never);
                if (reason) return refuse("not-ready", reason);
                const refusal = (await action.run(ctx as never, parsed.data as never)) ?? null;
                if (!refusal)
                  for (const reading of action.dirties) {
                    const request = readingAtoms.find(([name]) => name === reading)?.[2];
                    if (request) owner.write(name, `dirty/${reading}`, () => dirty(request));
                  }
                return refusal;
              },
              undefined,
              () => {
                stopped = true;
              },
              action.label,
            );
            setOutcome({ key: name, label: action.label, refusal, stopped, at: Date.now() });
            return refusal;
          },
        };
        return [name, handle];
      }),
    ) as Record<A, ActionHandle>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manifest,
    resolution,
    inventoryResult,
    readingAtoms,
    readings,
    page,
    doc,
    workCurrent,
    writer,
    owner,
    seed,
    key,
    actionScope,
  ]);

  const workHandle = useMemo(
    () => ({
      key,
      doc: (doc?.doc ?? null) as W | null,
      revision: doc?.revision ?? null,
      current: workCurrent,
      write: writeWork,
      conflict: conflictNow,
      reload: () => {
        if (seed) return;
        owner.registry.set(owner.conflict, false);
        if (spec) dirty({ ...key, kind: "work" });
      },
    }),
    [key, doc, workCurrent, writeWork, owner, conflictNow, spec, seed],
  );

  return {
    manifest,
    resolution,
    chosen: target,
    head: headRequest && headResult ? { thread: headRequest.thread, ...scope } : null,
    work: workHandle,
    readings,
    inventory: seededReadings ? (seededReadings.inventory ?? { state: "absent" }) : inventoryResult,
    page: [page, setPage] as const,
    actions,
    busy,
    stop: owner.stop,
    failure,
    outcome,
    log,
    demo: seed !== undefined,
  };
}
