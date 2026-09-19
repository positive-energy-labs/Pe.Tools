/**
 * The route layer's one reach to the host. §7 ("nothing below the route reaches the host") puts
 * every route-state write behind this file, so `use-route.ts` owns sequencing and refusal and
 * never the transport.
 */
import { type RouteStateWriteResult } from "@pe/agent-contracts";

export type RouteWriteResponse = { status: number; result: RouteStateWriteResult | null };

/** POST one route-state write. A body that is not a write result comes back as `null`. */
export async function postRouteWrite(
  url: string,
  body: Record<string, unknown>,
): Promise<RouteWriteResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as RouteStateWriteResult | null;
  return { status: response.status, result };
}

/**
 * The route's salvage of Work it can no longer read (human door only): `{ from, value }`, or null
 * when there is nothing to salvage. A refusal throws in the host's words.
 */
export async function getRouteSalvage(
  url: string,
): Promise<{ from: string; value: unknown } | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  const body = (await response.json().catch(() => null)) as
    | { from: string; value: unknown }
    | { error?: string; message?: string }
    | null;
  if (!response.ok || !body || !("from" in body))
    throw Error(
      (body && "message" in body && body.message) ||
        (body && "error" in body && body.error) ||
        `salvage failed (${response.status})`,
    );
  return body;
}
