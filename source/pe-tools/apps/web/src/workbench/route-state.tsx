/** Thread-scoped route documents over the host RouteWorkspace API. */
import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Cause, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { z } from "zod";

import {
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";

export type { RouteStatePatch, RouteStateWriteResult } from "@pe/agent-contracts";

import { docAtom, docWriter, type Scope } from "#/state/route-store";
import { type WorkbenchEndpointConfig, peUrl } from "./config";

export interface RouteStateHandle<T> {
  slice: T | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[]) => Promise<RouteStateWriteResult>;
  command: (command: string, input?: unknown) => Promise<RouteStateWriteResult>;
  peaActive: boolean;
  connected: boolean | null;
  error: string | null;
}

export function useRouteState<TSchema extends z.ZodType>(
  spec: RouteStateSpec<TSchema>,
  scope: Scope,
): RouteStateHandle<z.infer<TSchema>> {
  const wireResult = useAtomValue(docAtom(spec, scope));
  const wire = AsyncResult.isSuccess(wireResult) ? wireResult.value : null;
  const failure = AsyncResult.isFailure(wireResult) ? wireResult.cause : null;
  const writer = useMemo(() => docWriter(spec, scope), [spec, scope.threadId]);

  return {
    slice: wire?.doc ?? null,
    hydrated: wire?.hydrated ?? false,
    apply: writer.apply,
    command: (command, input) => writer.command(command as keyof TSchema & string, input),
    peaActive: wire?.peaActive ?? false,
    connected: failure ? false : (wire?.connected ?? null),
    error: failure
      ? Option.getOrElse(
          Option.map(Cause.findErrorOption(failure), (caught) => caught.message),
          () => "wire failed",
        )
      : (wire?.error ?? null),
  };
}

export async function writeRouteState(
  config: WorkbenchEndpointConfig,
  route: string,
  suffix: "apply" | "command",
  body: Record<string, unknown>,
  scope: Scope,
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
  scope: Scope,
): string {
  const suffix = operation === "read" ? "" : `/${operation}`;
  const url = new URL(peUrl(config, `/route-state/${route}${suffix}`));
  url.searchParams.set("threadId", scope.threadId);
  return url.toString();
}
