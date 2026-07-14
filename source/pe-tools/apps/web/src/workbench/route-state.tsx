/**
 * useRouteState — the collaborative-UI primitive, standalone, on Effect.Atom.
 *
 * The doc pipeline is an Atom per route spec (`routeWireAtom`): one Stream that
 * subscribes to the session SSE wire, hydrates once via GET (push wins the race),
 * and folds `state_changed` / `agent_start` / `agent_end` into a wire state. Every
 * component reading the same spec shares ONE subscription through the atom registry —
 * the chat inline plugin and the full route page no longer each open their own wire.
 *
 * Writes go through the browser dispatcher endpoints (server-owned human actor):
 * `apply` posts segment-array patches, `command` runs a named side-effect. Every
 * write's result echoes back through `state_changed`, so the atom stays authoritative.
 * Pea writes the same document server-side (masked); its changes arrive identically.
 *
 * `useRouteDraft` is the local-edit primitive: an optional OVERRIDE (None = follow
 * remote, Some = hold the dirty edit) with value and dirty derived from it — the
 * clobber-guard is structural (`getOrElse(remote)`), not an effect chasing a ref.
 */
import { useCallback, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

import { type RouteStateSpec, readRouteState } from "@pe/agent-contracts";

import { type WorkbenchEndpointConfig, peUrl, resolveWorkbenchConfig } from "./config";
import { parseWireEvent } from "./wire";

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });

/** A single segment-array patch. Omit `value` (or set it undefined) to delete the key. */
export interface RouteStatePatch {
  path: (string | number)[];
  value?: unknown;
}

/** The dispatcher's apply/command reply — `hint` is teaching text to surface verbatim. */
export interface RouteStateWriteResult {
  ok: boolean;
  error?: string;
  hint?: string;
  doc?: unknown;
  result?: unknown;
}

export interface RouteStateHandle<T> {
  /** The parsed route slice; null until hydrated or when absent/invalid. */
  slice: T | null;
  /** True once the document has arrived (via GET hydration or a state_changed echo). */
  hydrated: boolean;
  /** Apply segment-array patches as the human actor (bypasses the agent mask). */
  apply: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  /** Run a named command as the human actor. */
  command: (command: string, input?: unknown) => Promise<RouteStateWriteResult>;
  /** True while a pea run is in flight on this session (agent_start..agent_end). */
  peaActive: boolean;
  connected: boolean;
  error: string | null;
}

/* ── the wire, as an Atom family (one subscription per route spec) ─────────── */

interface WireState {
  doc: unknown;
  hydrated: boolean;
  peaActive: boolean;
}

type WireMessage = { kind: "doc"; doc: unknown } | { kind: "pea"; active: boolean };

const INITIAL_WIRE: WireState = { doc: null, hydrated: false, peaActive: false };

function wireStream(
  config: WorkbenchEndpointConfig,
  spec: RouteStateSpec<z.ZodType>,
): Stream.Stream<WireState, Error> {
  return Stream.callback<WireMessage, Error>((queue) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(peUrl(config, "/info"));
          if (!response.ok) throw new Error(`workbench /info ${response.status}`);
          const info = peInfoSchema.parse(await response.json());
          const session = new MastraClient({ baseUrl: config.origin })
            .getAgentController(info.controllerId)
            .session(info.resourceId);

          let pushSeen = false;
          const subscription = await session.subscribe({
            onEvent: (raw: unknown) => {
              const event = parseWireEvent(raw);
              if (!event) return;
              if (event.type === "state_changed") {
                pushSeen = true;
                Queue.offerUnsafe(queue, { kind: "doc", doc: event.state[spec.key] ?? null });
              } else if (event.type === "agent_start") {
                Queue.offerUnsafe(queue, { kind: "pea", active: true });
              } else if (event.type === "agent_end") {
                Queue.offerUnsafe(queue, { kind: "pea", active: false });
              }
            },
            onError: () => undefined, // stream ended/erred; the next state_changed re-syncs
          });

          // Hydrate AFTER subscribing; a push that already landed wins over the GET.
          void fetch(peUrl(config, `/route-state/${spec.route}`))
            .then(async (r) => (r.ok ? await r.json() : null))
            .then((payload: { doc?: unknown } | null) => {
              if (!pushSeen && payload?.doc != null)
                Queue.offerUnsafe(queue, { kind: "doc", doc: payload.doc });
            })
            .catch(() => undefined);

          return subscription.unsubscribe;
        },
        catch: (caught) => (caught instanceof Error ? caught : new Error(String(caught))),
      }),
      (unsubscribe) => Effect.sync(() => unsubscribe()),
    ),
  ).pipe(
    Stream.scan(INITIAL_WIRE, (state, message) =>
      message.kind === "doc"
        ? { ...state, doc: message.doc, hydrated: true }
        : { ...state, peaActive: message.active },
    ),
  );
}

/** One wire atom per route spec — specs are stable module objects, so the family key holds. */
const routeWireAtom = Atom.family((spec: RouteStateSpec<z.ZodType>) =>
  Atom.make(wireStream(resolveWorkbenchConfig(), spec)),
);

/* ── the facade hook (same shape the plugins already speak) ────────────────── */

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
): RouteStateHandle<z.infer<TSchema>> {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const wireResult = useAtomValue(routeWireAtom(spec as unknown as RouteStateSpec<z.ZodType>));

  const wire = AsyncResult.isSuccess(wireResult) ? wireResult.value : INITIAL_WIRE;
  const failure = AsyncResult.isFailure(wireResult) ? wireResult.cause : null;

  const apply = useCallback(
    (patches: RouteStatePatch[]) => writeRouteState(config, spec.route, "apply", { patches }),
    [config, spec.route],
  );
  const command = useCallback(
    (command: string, input?: unknown) =>
      writeRouteState(config, spec.route, "command", { command, input: input ?? {} }),
    [config, spec.route],
  );

  const slice = useMemo(
    () => (wire.hydrated ? readRouteState({ [spec.key]: wire.doc }, spec) : null),
    [wire.hydrated, wire.doc, spec],
  );

  return {
    slice,
    hydrated: wire.hydrated,
    apply,
    command,
    peaActive: wire.peaActive,
    connected: failure == null,
    error: failure
      ? Option.getOrElse(
          Option.map(Cause.findErrorOption(failure), (caught) => caught.message),
          () => "wire failed",
        )
      : null,
  };
}

/* ── the draft primitive (override + derived value/dirty — Atom's shape) ───── */

export interface RouteDraftHandle<T> {
  /** The resolved value: the dirty local override when present, else remote. */
  value: T;
  dirty: boolean;
  /** Hold a local edit; pushes stop affecting `value` until save/discard. */
  edit: (next: T) => void;
  /** Persist the override; on success drop it so `value` follows remote again. */
  save: () => Promise<RouteStateWriteResult>;
  discard: () => void;
}

/**
 * Local draft of one remote value that server pushes must not clobber while dirty.
 * ponytail: hook-local override; lift to an Atom family when two components need
 * to share one draft.
 */
export function useRouteDraft<T>(
  remote: T,
  persist: (value: T) => Promise<RouteStateWriteResult>,
): RouteDraftHandle<T> {
  const [override, setOverride] = useState<Option.Option<T>>(Option.none());

  const value = Option.getOrElse(override, () => remote);
  const dirty = Option.isSome(override);

  const edit = useCallback((next: T) => setOverride(Option.some(next)), []);
  const discard = useCallback(() => setOverride(Option.none()), []);
  const save = useCallback(async () => {
    const result = await persist(value);
    if (result.ok) setOverride(Option.none());
    return result;
  }, [persist, value]);

  return { value, dirty, edit, save, discard };
}

/* ── reactive command (AsyncResult pending/error off an Atom.fn) ───────────── */

const routeCommandAtom = Atom.family((key: string) => {
  const [route, command] = splitCommandKey(key);
  return Atom.fn((input: unknown) =>
    Effect.promise(() =>
      writeRouteState(resolveWorkbenchConfig(), route, "command", { command, input: input ?? {} }),
    ).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.succeed(result) : Effect.fail(result.error ?? `${command} failed`),
      ),
    ),
  );
});

export interface RouteCommandHandle {
  run: (input?: unknown) => void;
  pending: boolean;
  error: string | null;
}

/** A named route command with reactive pending/error (shared across components). */
export function useRouteCommand(route: string, command: string): RouteCommandHandle {
  const [result, run] = useAtom(routeCommandAtom(commandKey(route, command)));
  return {
    run,
    pending: AsyncResult.isWaiting(result),
    error: AsyncResult.isFailure(result)
      ? Option.getOrElse(
          Option.map(Cause.findErrorOption(result.cause), (message) => String(message)),
          () => "failed",
        )
      : null,
  };
}

/** Route names can't contain "\n"; commands ride after it. */
function commandKey(route: string, command: string): string {
  return `${route}\n${command}`;
}
function splitCommandKey(key: string): [string, string] {
  const idx = key.indexOf("\n");
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/** POST a human-actor write to a dispatcher endpoint; returns its `{ ok, hint, ... }` reply. */
export async function writeRouteState(
  config: WorkbenchEndpointConfig,
  route: string,
  suffix: "apply" | "command",
  body: Record<string, unknown>,
): Promise<RouteStateWriteResult> {
  try {
    const response = await fetch(peUrl(config, `/route-state/${route}/${suffix}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as RouteStateWriteResult | null;
    if (payload) return payload;
    return { ok: false, error: `${suffix} failed (${response.status})` };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }
}
