import { Cause, Effect, Equal, Hash, Layer, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

import {
  parseRouteDoc,
  type RouteDocOf,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

import { inspectAtomRegistry } from "#/state/atom-inspect";
import type { Option } from "#/targeting/model";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";
import { parseWireEvent } from "#/workbench/wire";

export type VerbFailure = { kind: "busy" | "host"; verb: string; message: string };
export type VerbReceipt = { verb: string; text: string; at: number };
export class VerbRefused extends Error {
  readonly name = "VerbRefused";

  constructor(readonly verb: string) {
    super(`${verb} refused; another verb is running`);
  }
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
        kind: "busy",
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
      if (
        typeof value === "object" &&
        value !== null &&
        "ok" in value &&
        value.ok === false
      ) {
        const result = value as RouteStateWriteResult;
        throw Error([result.error, result.hint].filter(Boolean).join(": ") || `${id} failed`);
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
      if (keys?.length) write(id, `invalidate/${keys.join(",")}`, () => registry.set(invalidate, keys));
      return value;
    } catch (cause) {
      const hostFailure = {
        kind: "host",
        verb: id,
        message: cause instanceof Error ? cause.message : String(cause),
      } as const;
      write(id, "failure", () => registry.set(failure, hostFailure));
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

export type FeedState = "ready" | "loading" | "error";
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
  readonly threadId: string;
}

export interface Slice<D> {
  doc: D | null;
  hydrated: boolean;
  connected: boolean | null;
  error: string | null;
  peaActive: boolean;
}

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });
type WireMessage =
  | { kind: "doc"; doc: unknown }
  | { kind: "pea"; active: boolean }
  | { kind: "connected"; value: boolean };

class RouteAtomKey implements Equal.Equal {
  constructor(readonly spec: RouteStateSpec<any>, readonly scope: Scope) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof RouteAtomKey && this.spec.route === that.spec.route && this.scope.threadId === that.scope.threadId;
  }
  [Hash.symbol]() {
    return Hash.string(`${this.spec.route}\0${this.scope.threadId}`);
  }
}

function routeUrl(route: string, operation: "read" | "events" | "apply" | "command", scope: Scope) {
  const config = resolveWorkbenchConfig();
  const suffix = operation === "read" ? "" : `/${operation}`;
  const url = new URL(peUrl(config, `/route-state/${route}${suffix}`));
  url.searchParams.set("threadId", scope.threadId);
  return url.toString();
}

const routeAtom = Atom.family((key: RouteAtomKey) => {
  const { spec, scope } = key;
  const initial: Slice<RouteDocOf<typeof spec>> = {
    doc: null,
    hydrated: false,
    connected: null,
    error: null,
    peaActive: false,
  };
  const config = resolveWorkbenchConfig();
  return Atom.make(Stream.callback<WireMessage, Error>((queue) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(peUrl(config, "/info"));
          if (!response.ok) throw Error(`workbench /info ${response.status}`);
          const info = peInfoSchema.parse(await response.json());
          const session = new MastraClient({ baseUrl: config.origin })
            .getAgentController(info.controllerId)
            .session(info.resourceId);
          const hydrated = await fetch(routeUrl(spec.route, "read", scope));
          if (!hydrated.ok) throw Error(`route workspace read ${hydrated.status}`);
          const payload = (await hydrated.json()) as { doc?: unknown };
          if ("doc" in payload) Queue.offerUnsafe(queue, { kind: "doc", doc: payload.doc ?? null });
          const unsubscribeSession = await session.subscribe({
            onEvent: (raw: unknown) => {
              const event = parseWireEvent(raw);
              if (event?.type === "agent_start") Queue.offerUnsafe(queue, { kind: "pea", active: true });
              else if (event?.type === "agent_end") Queue.offerUnsafe(queue, { kind: "pea", active: false });
            },
            onError: () => undefined,
          });
          const events = new EventSource(routeUrl(spec.route, "events", scope));
          events.onopen = () => Queue.offerUnsafe(queue, { kind: "connected", value: true });
          events.onerror = () => Queue.offerUnsafe(queue, { kind: "connected", value: false });
          events.onmessage = (raw) => {
            try {
              const payload = JSON.parse(raw.data) as { doc?: unknown };
              if ("doc" in payload)
                Queue.offerUnsafe(queue, { kind: "doc", doc: payload.doc ?? null });
            } catch {
              // The next valid snapshot remains authoritative.
            }
          };
          return () => {
            events.close();
            unsubscribeSession.unsubscribe();
          };
        },
        catch: (cause) => (cause instanceof Error ? cause : Error(String(cause))),
      }),
      (close) => Effect.sync(close),
    ),
  ).pipe(
    Stream.scan(initial, (state, message): Slice<RouteDocOf<typeof spec>> =>
      message.kind === "pea"
        ? { ...state, peaActive: message.active }
        : message.kind === "connected"
          ? { ...state, connected: message.value }
        : {
            ...state,
            doc: parseRouteDoc(message.doc, spec),
            hydrated: true,
          },
    ),
  ));
});

export function docAtom<S extends RouteStateSpec<any>>(
  spec: S,
  scope: Scope,
): Atom.Atom<AsyncResult.AsyncResult<Slice<RouteDocOf<S>>, Error>> {
  return routeAtom(new RouteAtomKey(spec, scope));
}

export function docWriter<S extends RouteStateSpec<any>>(spec: S, scope: Scope) {
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
      return (
        ((await response.json().catch(() => null)) as RouteStateWriteResult | null) ?? {
          ok: false,
          error: `${operation} failed (${response.status})`,
        }
      );
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  };
  return {
    apply: (patches: RouteStatePatch[]) => write("apply", { patches }),
    command: (name: keyof S["commands"] & string, input?: unknown) =>
      write("command", { command: name, input: input ?? {} }),
  };
}
