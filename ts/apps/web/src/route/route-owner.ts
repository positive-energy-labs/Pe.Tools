/** The route owner: one per route and registry; it holds the log, the runner and the page. */
import type { InspectableRef } from "./inspect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ExecutionTarget, TrichotomyCellLike } from "@pe/agent-contracts";
import { Layer } from "effect";
import { inspectAtomRegistry, type OwnerReferences } from "#/state/atom-inspect";
import { causeRefusal, refuse, type Refusal } from "./refusal";
import { cancelRunningAdmissions } from "../../../../packages/mcps/src/shared/takeoff-action-client";

/** A resolved Target is only ever two headers on the one `/call` endpoint. */
export const targetHeaders = (target: ExecutionTarget) =>
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
export function useOwned<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A> | null,
): A | null {
  const subscribe = useMemo(
    () => (notify: () => void) => (atom ? registry.subscribe(atom, notify) : () => {}),
    [registry, atom],
  );
  return useSyncExternalStore(subscribe, () => (atom ? registry.get(atom) : null));
}

export type Slice<D> = { doc: D; revision: number } | { doc: null; revision: null };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Internal unwind only; the public action boundary still returns the structured refusal. */
export class ActionRefusal extends Error {
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
  const note = (
    kind: LogEntry["kind"],
    label: string,
    says: string,
    refused = false,
    action?: string,
    link?: InspectableRef,
  ) =>
    registry.set(log, [
      {
        at: new Date().toLocaleTimeString([], { hour12: false }),
        kind,
        label,
        says,
        refused,
        action,
        link,
      },
      ...registry.get(log).slice(0, 199),
    ]);

  let stopper: (() => void) | null = null;
  /** The running verb's button word and start, for a busy refusal to name (and say how long). */
  let runningLabel = "";
  let runningSince = 0;

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
    /** In flight past this, the verb ends as stopped and releases busy; Infinity = unbounded. */
    waitSeconds = Infinity,
  ): Promise<Refusal | null> => {
    const verb = (says: string, refused = false) => note("verb", label, says, refused, key);
    if (inFlight) {
      // A busy refusal is a refusal like any other: on the verb, and one line in the page log.
      const running = Math.floor((Date.now() - runningSince) / 1000);
      const refusal = refuse("busy", `${runningLabel} still running (${running}s)`);
      write(key, "failure", () => registry.set(failure, refusal));
      verb(`refused · ${refusal.message}`, true);
      return refusal;
    }
    inFlight = true;
    runningLabel = label;
    runningSince = Date.now();
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
          if (refused.length) verb(`stop refused · ${refused.join(" ")}`, true);
          else resolve("stopped");
        });
      };
    });
    // The bound: past it the verb ends honestly (never success, never a retry) and busy is
    // released; the op may still answer, and that late answer is only logged and re-read below.
    let bound: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      if (Number.isFinite(waitSeconds))
        bound = setTimeout(() => resolve("timeout"), waitSeconds * 1000);
    });
    try {
      const running = work();
      const result = await Promise.race([running, stopped, timedOut]);
      if (result === "timeout") {
        const refusal = refuse("unknown", `stopped: no answer after ${waitSeconds}s`);
        write(key, "failure", () => registry.set(failure, refusal));
        verb(refusal.message, true);
        running
          .then(
            (late) =>
              !disposed &&
              verb(
                `late · ${late ? outcomeSays(late) : "answered"} after the stop; re-reading, nothing retried`,
                Boolean(late),
              ),
            (cause: unknown) =>
              !disposed && verb(`late · failed · ${refusalOf(cause).message}`, true),
          )
          .finally(() => {
            // A late answer only refreshes what the verb dirties; it never writes on its own.
            if (!disposed) invalidateKeys();
          });
        onStopped?.();
        return refusal;
      }
      if (result === "stopped") {
        verb("stopped · cancel signalled; the op stops at its next checkpoint", true);
        const late = (says: string, refusal: Refusal | null) => {
          if (disposed) return;
          write(key, "failure", () => registry.set(failure, refusal));
          verb(`late · ${says}`, Boolean(refusal));
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
      verb(result ? outcomeSays(result) : "ran", Boolean(result));
      // A partial outcome landed something: what it dirties is stale either way.
      if (!result || result.code === "partial") invalidateKeys();
      return result;
    } catch (cause) {
      const refusal = refusalOf(cause);
      write(key, "failure", () => registry.set(failure, refusal));
      verb(`failed · ${refusal.message}`, true);
      return refusal;
    } finally {
      clearTimeout(bound);
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

/** One page-log line. `refused` draws the caution hue; the text is the whole reason. */
export interface LogEntry {
  readonly at: string;
  readonly kind: "verb" | "target" | "stage" | "work";
  readonly label: string;
  readonly says: string;
  readonly refused: boolean;
  /** The action key of a verb entry; its reading tabs derive from the action's `dirties`. */
  readonly action?: string;
  /** What the entry produced, resolved through the manifest's inspectables when drawn. */
  readonly link?: InspectableRef;
}

/** What a bare run lacks: the fields an empty object misses, or "a value" when it is not an object. */
export const missingFields = (schema: {
  safeParse: (value: unknown) => {
    success: boolean;
    error?: { issues: { path: PropertyKey[] }[] };
  };
}) => {
  const issues = schema.safeParse({}).error?.issues ?? [];
  const names = issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean);
  return names.length ? names.join(", ") : "a value";
};

/**
 * How the page log says a verb's returned outcome. A sentence that already names what happened
 * ("partly applied: …", "refused — nothing ran: …", "failed in Revit — …") is said as is; any
 * other refusal is prefixed so a refusal never reads as a failure, nor a failure as a refusal.
 */
const outcomeSays = (refusal: Refusal) =>
  /^(partly applied|refused|failed)/.test(refusal.message)
    ? refusal.message
    : `${refusal.code === "failed" ? "failed" : "refused"} · ${refusal.message}`;

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

/** Staged and proposed cell counts: what a Work revision changed, when the route has cells. */
type CellTally = { staged: number; proposed: number };

const cells = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What one Work revision did to its cells, as the person would say it. */
function workWords(was: CellTally | null, now: CellTally | null, revision: number) {
  if (!was || !now) return `loaded Work r${revision}`;
  const staged = now.staged - was.staged;
  const proposed = now.proposed - was.proposed;
  if (staged > 0 && proposed < 0) return `accepted ${cells(staged, "proposal")}`;
  if (staged > 0) return `staged ${cells(staged, "cell")}`;
  if (staged < 0) return `unstaged ${cells(-staged, "cell")}`;
  if (proposed > 0) return `Pea proposed ${cells(proposed, "cell")}`;
  if (proposed < 0) return `cleared ${cells(-proposed, "proposal")}`;
  return `changed Work r${revision}`;
}

/**
 * Page-log rows for the three events that are not verbs (Situation, 2026-09-13): the target
 * binding, the stage word and the Work revision. Each notes only when its value changes, with a
 * label that says what happened; hover keeps the detail.
 */
export function usePageLogNotes(
  owner: Pick<ReturnType<typeof createRouteOwner>, "note">,
  now: {
    target: string;
    stage: string | undefined;
    /** The Work slice, and the segment its cells sit in when the route declares cells. */
    work: { slice: Slice<unknown> | null; segment: string | undefined };
    lost: { ref: { session: string; openId: string }; reason: string } | null;
  },
) {
  const { target, stage, lost } = now;
  const revision = now.work.slice?.revision ?? null;
  const { segment } = now.work;
  const cells = segment
    ? Object.values(
        ((now.work.slice?.doc ?? {}) as Record<string, Record<string, TrichotomyCellLike>>)[
          segment
        ] ?? {},
      )
    : null;
  const staged = cells?.filter((cell) => cell.staged != null).length ?? null;
  const proposed =
    cells?.filter((cell) => cell.proposal != null && cell.staged == null).length ?? null;
  const lostKey = lost ? `${lost.ref.session}/${lost.ref.openId}` : null;
  const seen = useRef({
    target,
    stage,
    revision,
    tally: null as CellTally | null,
    lost: null as string | null,
  });
  useEffect(() => {
    const tally = staged === null || proposed === null ? null : { staged, proposed };
    if (seen.current.target !== target) {
      seen.current.target = target;
      const bound = JSON.parse(target) as { session: string; openId: string } | null;
      // A lost binding notes itself below, with its reason, on load as on a transition.
      if (bound || !lost)
        owner.note(
          "target",
          bound ? `bound ${bound.openId}` : "unbound",
          bound ? `${bound.session} › ${bound.openId}` : "no document",
        );
    }
    if (seen.current.lost !== lostKey) {
      seen.current.lost = lostKey;
      if (lost) owner.note("target", `unbound: ${lost.reason.replace("-", " ")}`, lostKey!);
    }
    if (seen.current.stage !== stage) {
      seen.current.stage = stage;
      if (stage) owner.note("stage", `now ${stage.toLowerCase()}`, stage);
    }
    if (seen.current.revision !== revision) {
      seen.current.revision = revision;
      if (revision !== null)
        owner.note("work", workWords(seen.current.tally, tally, revision), `r${revision}`);
      seen.current.tally = tally;
    }
  }, [owner, target, stage, revision, staged, proposed, lostKey, lost]);
}
