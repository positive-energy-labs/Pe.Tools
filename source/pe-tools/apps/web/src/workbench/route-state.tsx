/**
 * useRouteState — the collaborative-UI primitive, standalone.
 *
 * Any route can mount this hook (no WorkbenchProvider needed). It:
 *   - runs the `/pe/info` handshake, opens its own session client, and subscribes to
 *     the SSE wire (filtering `state_changed` for live updates, `agent_start/end` for
 *     the pea-active flag),
 *   - hydrates the route's document once via `GET /pe/route-state/:route` (replacing the
 *     old zero-key `setState({})` nudge — the dispatcher exposes the doc directly now),
 *   - writes through the browser dispatcher endpoints (server-owned human actor): `apply`
 *     posts segment-array patches, `command` runs a named side-effect. Every write's
 *     result echoes back through `state_changed`, so the slice stays authoritative.
 *
 * Pea writes the same document server-side (masked); its changes arrive here identically.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
): RouteStateHandle<z.infer<TSchema>> {
  const config = useMemo(() => resolveWorkbenchConfig(), []);
  const [session, setSession] = useState<SessionClient | null>(null);
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [peaActive, setPeaActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handshake: learn controller/resource ids, build the session client.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(peUrl(config, "/info"));
        if (!response.ok) throw new Error(`workbench /info ${response.status}`);
        const info = peInfoSchema.parse(await response.json());
        if (cancelled) return;
        const controller = new MastraClient({ baseUrl: config.origin }).getAgentController(
          info.controllerId,
        );
        setSession(controller.session(info.resourceId));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Hydrate the document from the dispatcher (authoritative snapshot, no live merge needed).
  useEffect(() => {
    let cancelled = false;
    void fetch(peUrl(config, `/route-state/${spec.route}`))
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((payload: { doc?: unknown } | null) => {
        if (cancelled || payload?.doc == null) return;
        setValues((prev) => ({ ...prev, [spec.key]: payload.doc }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config, spec.route, spec.key]);

  // One SSE subscription; state_changed carries the full map, agent_start/end drive peaActive.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let unsubscribe = () => {};
    void session
      .subscribe({
        onEvent: (raw: unknown) => {
          const event = parseWireEvent(raw);
          if (!event) return;
          if (event.type === "state_changed") setValues(event.state);
          else if (event.type === "agent_start") setPeaActive(true);
          else if (event.type === "agent_end") setPeaActive(false);
        },
        onError: () => undefined, // stream ended/erred; the next state_changed re-syncs
      })
      .then((subscription) => {
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session]);

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
    () => (values ? readRouteState(values, spec) : null),
    // spec is a stable module-level object for callers by convention
    [values, spec],
  );

  return {
    slice,
    hydrated: values != null,
    apply,
    command,
    peaActive,
    connected: session != null && error == null,
    error,
  };
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

type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;
