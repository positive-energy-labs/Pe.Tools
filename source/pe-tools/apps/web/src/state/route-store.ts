import { Cause, Effect, Equal, Hash, Layer, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { isKnownAgentControllerEvent, MastraClient } from "@mastra/client-js";

import {
  type Address,
  parseRouteDoc,
  type RouteDocOf,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
  type RouteWriteKind,
} from "@pe/agent-contracts";

import { inspectAtomRegistry } from "#/state/atom-inspect";
import { fetchPeInfo } from "#/host/info";
import type { Option } from "#/targeting/model";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

export type VerbFailure = { kind: RouteWriteKind; verb: string; message: string };
export type VerbReceipt = { verb: string; text: string; at: number };
export class VerbRefused extends Error {
  readonly name = "VerbRefused";

  constructor(readonly verb: string) {
    super(`${verb} refused; another verb is running`);
  }
}

export type RouteWriteRefusal = Extract<RouteStateWriteResult, { ok: false }>;
type RouteWriteOk = Extract<RouteStateWriteResult, { ok: true }>;

const note = (result: RouteWriteRefusal) => [result.error, result.hint].filter(Boolean).join(": ");

export class RouteWriteFailure extends Error {
  readonly name = "RouteWriteFailure";

  constructor(readonly result: RouteWriteRefusal) {
    super(note(result));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A command result may report per-item failures beside an overall ok. */
export function failuresNote(result: { result?: unknown }, noun: string): string | null {
  const failures = isRecord(result.result) ? result.result.failures : undefined;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return `${failures.length} ${noun}${failures.length === 1 ? "" : "s"} failed${
    detail ? `: ${detail}` : "."
  }`;
}

/** Refuse from inside a verb: the store stamps `kind:"refused"`, not `error`. */
export function refuse(error: string): never {
  throw new RouteWriteFailure({ ok: false, kind: "refused", error, hint: "" });
}

/** What a caught cause reports: a typed route refusal keeps its kind, anything else is an error. */
export const verbFailure = (verb: string, cause: unknown): VerbFailure => ({
  kind: cause instanceof RouteWriteFailure ? cause.result.kind : "error",
  verb,
  message: cause instanceof Error ? cause.message : String(cause),
});

export function expectRouteWrite(result: RouteStateWriteResult): RouteWriteOk {
  if (!result.ok) throw new RouteWriteFailure(result);
  return result;
}

export function createRouteStoreCore(route: string, registry: AtomRegistry.AtomRegistry) {
  const inspector = inspectAtomRegistry(registry);
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
  const write = <A>(verb: string, key: string, mutate: () => A): A => {
    inspector.note({ verb, key });
    return mutate();
  };

  const runtimeFactory = Atom.runtime;
  const runtime = keep(runtimeFactory(Layer.empty));
  Reflect.set(runtime.layer, "keepAlive", false);
  const invalidate = keep(runtime.fn((keys: readonly string[]) => Reactivity.invalidate(keys)));

  const busy = owned("verb/busy", Atom.make<{ id: string; seconds: number } | null>(null));
  const failure = owned("verb/failure", Atom.make<VerbFailure | null>(null));
  const receipt = owned("verb/receipt", Atom.make<VerbReceipt | null>(null));

  const runVerb = async <A>(
    id: string,
    work: () => Promise<A>,
    keys?: readonly string[],
  ): Promise<A> => {
    if (inFlight) {
      const error = new VerbRefused(id);
      const refused = {
        kind: "refused",
        verb: id,
        message: error.message,
      } as const;
      write(id, "failure", () => registry.set(failure, refused));
      throw error;
    }
    inFlight = true;
    write(id, "failure", () => registry.set(failure, null));
    write(id, "receipt", () => registry.set(receipt, null));
    write(id, "busy", () => registry.set(busy, { id, seconds: 0 }));
    const started = Date.now();
    busyTimer = setInterval(
      () =>
        write(id, "busy", () =>
          registry.set(busy, { id, seconds: Math.floor((Date.now() - started) / 1000) }),
        ),
      250,
    );
    try {
      const value = await work();
      if (isRecord(value) && value.ok === false) {
        const refusal = value as unknown as RouteWriteRefusal;
        write(id, "failure", () =>
          registry.set(failure, { kind: refusal.kind, verb: id, message: note(refusal) }),
        );
        return value;
      }
      const text =
        typeof value === "string"
          ? value
          : typeof value === "object" &&
              value !== null &&
              "text" in value &&
              typeof value.text === "string"
            ? value.text
            : id;
      write(id, "receipt", () => registry.set(receipt, { verb: id, text, at: Date.now() }));
      if (keys?.length)
        write(id, `invalidate/${keys.join(",")}`, () => registry.set(invalidate, keys));
      return value;
    } catch (cause) {
      write(id, "failure", () => registry.set(failure, verbFailure(id, cause)));
      throw cause;
    } finally {
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = undefined;
      inFlight = false;
      write(id, "busy", () => registry.set(busy, null));
    }
  };

  return {
    registry,
    owned,
    write,
    runVerb,
    busy,
    failure,
    receipt,
    /** The one busy/failure/receipt triple every store spreads onto its atoms. */
    verbAtoms: { busy, failure, receipt },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (busyTimer) clearInterval(busyTimer);
      for (const release of releases.splice(0).reverse()) release();
    },
  };
}

export interface TimedRead<A> {
  readonly value: A;
  readonly at: number;
  readonly basis: readonly string[];
  readonly bound: boolean;
}

export const hostRead = <A>(basis: readonly string[], read: () => Promise<A>) =>
  Effect.tryPromise({
    try: read,
    catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
  }).pipe(Effect.map((value): TimedRead<A> => ({ value, at: Date.now(), basis, bound: true })));

export const unbound = <A>(value: A, basis: readonly string[] = []): TimedRead<A> => ({
  value,
  at: Date.now(),
  basis,
  bound: false,
});

type FeedState = "ready" | "loading" | "error";
export type Lane = "live" | "read" | "fixture";
export interface Feed {
  options: Option[] | null;
  state: FeedState;
  lane: Lane;
  stale: boolean;
  at?: number;
  basis?: readonly string[];
  note?: string;
  seam?: { needs: string };
}

export function feed<A>(
  result: AsyncResult.AsyncResult<TimedRead<A>, Error>,
  options: (value: A) => Option[],
  lane: Lane,
  seam?: { needs: string },
): Feed {
  if (AsyncResult.isInitial(result))
    return { options: null, state: "loading", lane, stale: false, seam };
  if (AsyncResult.isFailure(result))
    return {
      options: null,
      state: "error",
      lane,
      stale: false,
      note: String(Cause.squash(result.cause)),
      seam,
    };
  if (!result.value.bound)
    return {
      options: null,
      state: "ready",
      lane,
      stale: false,
      basis: result.value.basis,
      seam,
    };
  return {
    options: options(result.value.value),
    state: "ready",
    lane,
    stale: result.waiting,
    at: result.value.at,
    basis: result.value.basis,
  };
}

export interface Scope {
  readonly documentAddress: Address;
}

export interface Slice<D> {
  doc: D | null;
  revision: number | null;
  hydrated: boolean;
  connected: boolean | null;
  error: string | null;
  peaActive: boolean;
}

export const routeConflictAtom = Atom.make(false).pipe(Atom.withLabel("app/route-conflict"));

type WireMessage =
  | { kind: "doc"; doc: unknown; revision: number }
  | { kind: "pea"; active: boolean }
  | { kind: "connected"; value: boolean };

class RouteAtomKey implements Equal.Equal {
  constructor(
    readonly spec: RouteStateSpec<any>,
    readonly scope: Scope,
  ) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return (
      that instanceof RouteAtomKey &&
      this.spec.route === that.spec.route &&
      this.scope.documentAddress === that.scope.documentAddress
    );
  }
  [Hash.symbol]() {
    return Hash.string(`${this.spec.route}\0${this.scope.documentAddress}`);
  }
}

function routeUrl(route: string, operation: "read" | "events" | "apply" | "command", scope: Scope) {
  const config = resolveWorkbenchConfig();
  const suffix = operation === "read" ? "" : `/${operation}`;
  const url = new URL(peUrl(config, `/route-state/${route}${suffix}`));
  url.searchParams.set("doc", scope.documentAddress);
  return url.toString();
}

const routeAtom = Atom.family((key: RouteAtomKey) => {
  const { spec, scope } = key;
  const initial: Slice<RouteDocOf<typeof spec>> = {
    doc: null,
    revision: null,
    hydrated: false,
    connected: null,
    error: null,
    peaActive: false,
  };
  const config = resolveWorkbenchConfig();
  return Atom.make(
    Stream.callback<WireMessage, Error>((queue) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const info = await fetchPeInfo(config);
            const hydrated = await fetch(routeUrl(spec.route, "read", scope));
            if (!hydrated.ok) throw Error(`route workspace read ${hydrated.status}`);
            const payload = (await hydrated.json()) as { doc?: unknown; revision?: unknown };
            if ("doc" in payload && Number.isInteger(payload.revision))
              Queue.offerUnsafe(queue, {
                kind: "doc",
                doc: payload.doc ?? null,
                revision: payload.revision as number,
              });
            let unsubscribeSession = () => {};
            const threadId = new URLSearchParams(window.location.search).get("thread")?.trim();
            if (threadId) {
              const session = new MastraClient({ baseUrl: config.origin })
                .getAgentController(info.controllerId)
                .session(info.resourceId, threadId);
              const running = await session.state({ threadId }).catch(() => undefined);
              Queue.offerUnsafe(queue, { kind: "pea", active: running?.running ?? false });
              const subscription = await session.subscribe({
                reconnect: true,
                onReconnect: async () => {
                  const state = await session.state({ threadId }).catch(() => undefined);
                  Queue.offerUnsafe(queue, { kind: "pea", active: state?.running ?? false });
                },
                onEvent: (event) => {
                  if (!isKnownAgentControllerEvent(event)) return;
                  if (event.type === "agent_start")
                    Queue.offerUnsafe(queue, { kind: "pea", active: true });
                  else if (event.type === "agent_end")
                    Queue.offerUnsafe(queue, { kind: "pea", active: false });
                },
                onError: () => Queue.offerUnsafe(queue, { kind: "pea", active: false }),
              });
              unsubscribeSession = subscription.unsubscribe;
            }
            const events = new EventSource(routeUrl(spec.route, "events", scope));
            events.onopen = () => Queue.offerUnsafe(queue, { kind: "connected", value: true });
            events.onerror = () => Queue.offerUnsafe(queue, { kind: "connected", value: false });
            events.onmessage = (raw) => {
              try {
                const payload = JSON.parse(raw.data) as { doc?: unknown; revision?: unknown };
                if ("doc" in payload && Number.isInteger(payload.revision))
                  Queue.offerUnsafe(queue, {
                    kind: "doc",
                    doc: payload.doc ?? null,
                    revision: payload.revision as number,
                  });
              } catch {
                // The next valid snapshot remains authoritative.
              }
            };
            return () => {
              events.close();
              unsubscribeSession();
            };
          },
          catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
        }),
        (close) => Effect.sync(close),
      ),
    ).pipe(
      Stream.scan(
        initial,
        (state, message): Slice<RouteDocOf<typeof spec>> =>
          message.kind === "pea"
            ? { ...state, peaActive: message.active }
            : message.kind === "connected"
              ? { ...state, connected: message.value }
              : {
                  ...state,
                  doc: parseRouteDoc(message.doc, spec),
                  revision: message.revision,
                  hydrated: true,
                },
      ),
    ),
  );
});

export function docAtom<S extends RouteStateSpec<any>>(
  spec: S,
  scope: Scope,
): Atom.Atom<AsyncResult.AsyncResult<Slice<RouteDocOf<S>>, Error>> {
  return routeAtom(new RouteAtomKey(spec, scope));
}

/** A refusal the browser itself produces; the server's refusals arrive typed already. */
export const fail = (error: string, kind: RouteWriteKind, hint = ""): RouteWriteRefusal => ({
  ok: false,
  kind,
  error,
  hint,
});

const notHydrated = fail("route document is not hydrated", "refused");

export function docWriter<S extends RouteStateSpec<any>>(
  spec: S,
  scope: Scope,
  registry: AtomRegistry.AtomRegistry,
  slice: Atom.Atom<AsyncResult.AsyncResult<Slice<RouteDocOf<S>>, Error>>,
) {
  let lastWrittenRevision: number | null = null;
  const write = async (
    operation: "apply" | "command",
    body: Record<string, unknown>,
  ): Promise<RouteStateWriteResult> => {
    try {
      const response = await fetch(routeUrl(spec.route, operation, scope), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result =
        ((await response.json().catch(() => null)) as RouteStateWriteResult | null) ??
        fail(`${operation} failed (${response.status})`, "error");
      if (result.ok) lastWrittenRevision = Math.max(lastWrittenRevision ?? -1, result.revision);
      else if (result.code === "stale_revision") registry.set(routeConflictAtom, true);
      return result;
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };
  const pendingRequestIds = new Map<string, string>();
  const writeRevision = (explicit?: number): number | null => {
    const current = registry.get(slice);
    if (!AsyncResult.isSuccess(current) || current.value.revision === null) return null;
    return explicit ?? Math.max(current.value.revision, lastWrittenRevision ?? -1);
  };
  return {
    apply: (patches: RouteStatePatch[], expectedRevision?: number) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return Promise.resolve(notHydrated);
      return write("apply", { patches, expectedRevision: revision });
    },
    command: async (name: keyof S["commands"] & string, input?: unknown) => {
      const revision = writeRevision();
      if (revision === null) return notHydrated;
      // One request id per (command, input) until it lands: a re-click after a lost response
      // replays the receipt instead of mutating Revit twice. expectedRevision orders; requestId is at-most-once.
      const gesture = JSON.stringify([name, input ?? {}]);
      const external = spec.commands[name]?.mutatesExternal === true;
      const requestId = external
        ? (pendingRequestIds.get(gesture) ?? crypto.randomUUID())
        : undefined;
      if (requestId) pendingRequestIds.set(gesture, requestId);
      const result = await write("command", {
        command: name,
        input: input ?? {},
        expectedRevision: revision,
        ...(requestId ? { requestId } : {}),
      });
      if (result.ok) pendingRequestIds.delete(gesture);
      return result;
    },
  };
}
