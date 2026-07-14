/** Thread- or workspace-scoped route documents over the host RouteWorkspace API. */
import { useCallback, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Option, Queue, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

import { type RouteStateSpec, readRouteState } from "@pe/agent-contracts";

import { type WorkbenchEndpointConfig, peUrl, resolveWorkbenchConfig } from "./config";
import { parseWireEvent } from "./wire";

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });

export type RouteWorkspaceScope = { kind: "thread"; threadId: string } | { kind: "workspace" };

/** Chat panes carry `thread`; route pages without it are explicitly standalone workspaces. */
export function resolveRouteWorkspaceScope(search?: string): RouteWorkspaceScope {
  const source = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const threadId = new URLSearchParams(source).get("thread")?.trim();
  return threadId ? { kind: "thread", threadId } : { kind: "workspace" };
}

/** A single segment-array patch. Omit `value` to delete the key. */
export interface RouteStatePatch {
  path: (string | number)[];
  value?: unknown;
}

export interface RouteStateWriteResult {
  ok: boolean;
  error?: string;
  hint?: string;
  doc?: unknown;
  result?: unknown;
}

export interface RouteStateHandle<T> {
  slice: T | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  command: (command: string, input?: unknown) => Promise<RouteStateWriteResult>;
  peaActive: boolean;
  connected: boolean;
  error: string | null;
}

interface WireState {
  doc: unknown;
  hydrated: boolean;
  peaActive: boolean;
}

interface WireDescriptor {
  route: string;
  stateKey: string;
  scope: RouteWorkspaceScope;
}

type WireMessage = { kind: "doc"; doc: unknown } | { kind: "pea"; active: boolean };

const INITIAL_WIRE: WireState = { doc: null, hydrated: false, peaActive: false };

function wireStream(
  config: WorkbenchEndpointConfig,
  descriptor: WireDescriptor,
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

          // Hydrate before opening either long-lived stream. Chat + iframe roots otherwise
          // exhaust the browser's per-origin connection pool and strand this request. The
          // route SSE sends its current snapshot on connect, so it closes the hydration race.
          const initial = await fetch(
            routeWorkspaceUrl(config, descriptor.route, "read", descriptor.scope),
          );
          if (!initial.ok) throw new Error(`route workspace read ${initial.status}`);
          const payload = (await initial.json()) as { doc?: unknown };
          if ("doc" in payload) Queue.offerUnsafe(queue, { kind: "doc", doc: payload.doc ?? null });

          const unsubscribeSession = await session.subscribe({
            onEvent: (raw: unknown) => {
              const event = parseWireEvent(raw);
              if (event?.type === "agent_start")
                Queue.offerUnsafe(queue, { kind: "pea", active: true });
              else if (event?.type === "agent_end")
                Queue.offerUnsafe(queue, { kind: "pea", active: false });
            },
            onError: () => undefined,
          });

          const events = new EventSource(
            routeWorkspaceUrl(config, descriptor.route, "events", descriptor.scope),
          );
          events.onmessage = (raw) => {
            try {
              const payload = JSON.parse(raw.data) as { doc?: unknown };
              if (!("doc" in payload)) return;
              Queue.offerUnsafe(queue, { kind: "doc", doc: payload.doc ?? null });
            } catch {
              // Ignore malformed frames; the next valid snapshot is authoritative.
            }
          };

          return () => {
            events.close();
            unsubscribeSession.unsubscribe();
          };
        },
        catch: (caught) => (caught instanceof Error ? caught : new Error(String(caught))),
      }),
      (close) => Effect.sync(close),
    ),
  ).pipe(
    Stream.scan(INITIAL_WIRE, (state, message) =>
      message.kind === "doc"
        ? { ...state, doc: message.doc, hydrated: true }
        : { ...state, peaActive: message.active },
    ),
  );
}

/** A string key shares one wire across every inline card and dock for the same coordinate. */
const routeWireAtom = Atom.family((key: string) => {
  const descriptor = JSON.parse(key) as WireDescriptor;
  return Atom.make(wireStream(resolveWorkbenchConfig(), descriptor));
});

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  scope = resolveRouteWorkspaceScope(),
): RouteStateHandle<z.infer<TSchema>> {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const key = JSON.stringify({
    route: spec.route,
    stateKey: spec.key,
    scope,
  } satisfies WireDescriptor);
  const wireResult = useAtomValue(routeWireAtom(key));
  const wire = AsyncResult.isSuccess(wireResult) ? wireResult.value : INITIAL_WIRE;
  const failure = AsyncResult.isFailure(wireResult) ? wireResult.cause : null;

  const apply = useCallback(
    (patches: RouteStatePatch[]) =>
      writeRouteState(config, spec.route, "apply", { patches }, scope),
    [config, spec.route, scope.kind, scope.kind === "thread" ? scope.threadId : ""],
  );
  const command = useCallback(
    (command: string, input?: unknown) =>
      writeRouteState(config, spec.route, "command", { command, input: input ?? {} }, scope),
    [config, spec.route, scope.kind, scope.kind === "thread" ? scope.threadId : ""],
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

export interface RouteDraftHandle<T> {
  value: T;
  dirty: boolean;
  edit: (next: T) => void;
  save: () => Promise<RouteStateWriteResult>;
  discard: () => void;
}

/** Hold a local override until save/discard so remote pushes cannot clobber an active edit. */
export function useRouteDraft<T>(
  remote: T,
  persist: (value: T) => Promise<RouteStateWriteResult>,
): RouteDraftHandle<T> {
  const [override, setOverride] = useState<Option.Option<T>>(Option.none());
  const value = Option.getOrElse(override, () => remote);
  const edit = useCallback((next: T) => setOverride(Option.some(next)), []);
  const discard = useCallback(() => setOverride(Option.none()), []);
  const save = useCallback(async () => {
    const result = await persist(value);
    if (result.ok) setOverride(Option.none());
    return result;
  }, [persist, value]);
  return { value, dirty: Option.isSome(override), edit, save, discard };
}

export async function writeRouteState(
  config: WorkbenchEndpointConfig,
  route: string,
  suffix: "apply" | "command",
  body: Record<string, unknown>,
  scope = resolveRouteWorkspaceScope(),
): Promise<RouteStateWriteResult> {
  try {
    const response = await fetch(routeWorkspaceUrl(config, route, suffix, scope), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as RouteStateWriteResult | null;
    return payload ?? { ok: false, error: `${suffix} failed (${response.status})` };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }
}

function routeWorkspaceUrl(
  config: WorkbenchEndpointConfig,
  route: string,
  operation: "read" | "events" | "apply" | "command",
  scope: RouteWorkspaceScope,
): string {
  const suffix = operation === "read" ? "" : `/${operation}`;
  const url = new URL(peUrl(config, `/route-state/${route}${suffix}`));
  if (scope.kind === "thread") url.searchParams.set("threadId", scope.threadId);
  else url.searchParams.set("scope", "workspace");
  return url.toString();
}
