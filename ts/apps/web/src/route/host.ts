import { peRoutes } from "@pe/agent-contracts/pe-api";
import { peClient } from "#/host/pe-client";
import type { RouteStateWriteResult } from "@pe/agent-contracts";
export type RouteWriteResponse = { status: number; result: RouteStateWriteResult | null };
type WorkInput = { params: { route: string }; query: Record<string, string> };

export async function postRouteWrite(
  operation: "apply" | "command" | "start-fresh",
  input: WorkInput,
  body: unknown,
): Promise<RouteWriteResponse> {
  const response =
    operation === "apply"
      ? await peClient.response("work.apply", {
          ...input,
          body: peRoutes["work.apply"].body.parse(body),
        })
      : operation === "command"
        ? await peClient.response("work.command", {
            ...input,
            body: peRoutes["work.command"].body.parse(body),
          })
        : await peClient.response("work.fresh", { ...input, body: {} });
  const wire = await response.json().catch(() => null);
  return { status: response.status, result: response.ok ? wire : (wire?.error?.details ?? null) };
}

export async function getRouteSalvage(
  input: WorkInput,
): Promise<{ from: string; value: unknown } | null> {
  const response = await peClient.response("work.salvage", input);
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok || !body || typeof body.from !== "string")
    throw Error(body?.error?.message ?? `salvage failed (${response.status})`);
  return body;
}
