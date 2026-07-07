/**
 * useRouteState — the collaborative-UI primitive, standalone.
 *
 * Any route can mount this hook (no WorkbenchProvider needed): it opens its own
 * session client, subscribes to the SSE wire filtering `state_changed`, and
 * exposes the route's typed slice of AgentController session state. Writes go
 * through `session.setState` (server-serialized top-level merge → rebroadcast
 * to every tab and to pea's tools). Pea writes the same slice server-side via
 * `controllerContext.updateState`; changes arrive here as `state_changed`.
 *
 * Hydration: the curated GET /sessions/:id route doesn't expose raw state keys,
 * but a zero-key merge (`setState({})`) makes SessionState re-emit the full map
 * to all subscribers. ponytail: hydration nudge; replace with a raw-state GET
 * route if the empty-merge trick ever breaks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MastraClient } from "@mastra/client-js";
import { z } from "zod";

import { type RouteStateDef, readRouteState } from "@pe/agent-contracts";

import { resolveWorkbenchConfig, peUrl } from "./config";
import { parseWireEvent } from "./wire";

const peInfoSchema = z.object({ controllerId: z.string(), resourceId: z.string() });

export interface RouteStateHandle<T> {
  /** The parsed route slice; null until hydrated or when absent/invalid. */
  slice: T | null;
  /** True once the full session-state map has arrived at least once. */
  hydrated: boolean;
  /** Replace the route's slice (whole-key merge, optimistic locally). */
  setSlice: (next: T) => Promise<void>;
  /** True while a pea run is in flight on this session (agent_start..agent_end). */
  peaActive: boolean;
  connected: boolean;
  error: string | null;
}

export function useRouteState<TSchema extends z.ZodType>(
  def: RouteStateDef<TSchema>,
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
        // Hydration nudge: zero-key merge → server re-emits the full state map.
        void session.setState({}).catch(() => undefined);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session]);

  const valuesRef = useRef(values);
  valuesRef.current = values;

  const setSlice = useCallback(
    async (next: z.infer<TSchema>) => {
      if (!session) throw new Error("Workbench session not connected yet.");
      // Optimistic: the authoritative state_changed echo overwrites this shortly after.
      setValues((prev) => ({ ...prev, [def.key]: next }));
      await session.setState({ [def.key]: next });
    },
    [session, def.key],
  );

  const slice = useMemo(
    () => (values ? readRouteState(values, def) : null),
    // def is a stable module-level object for callers by convention
    [values, def],
  );

  return {
    slice,
    hydrated: values != null,
    setSlice,
    peaActive,
    connected: session != null && error == null,
    error,
  };
}

type SessionClient = ReturnType<ReturnType<MastraClient["getAgentController"]>["session"]>;
