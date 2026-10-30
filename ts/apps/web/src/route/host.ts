import { peRoutes } from "@pe/agent-contracts/pe-api";
import { peClient } from "#/host/pe-client";
import {
  workWriteAckSchema,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWriteAck,
  type WorkWrite,
} from "@pe/agent-contracts";
import { peReadings, type Readings } from "#/readings";
export function routeInput(route: string, key: WorkKey) {
  const query: Record<string, string> = {};
  if (key.work !== undefined) query.work = key.work;
  else {
    if (key.target !== null) query.target = key.target;
    const open = key.binding === "address" ? key.from : key.open;
    if (open) query.open = `${open.session}/${open.openId}`;
  }
  return { params: { route }, query };
}

/** Complete host acknowledgement, including inverse authority, for the graph's journal writer. */
export async function writeRouteWork(
  key: WorkKey,
  write: WorkWrite,
): Promise<RouteStateWriteResult> {
  const { result, status } = await postRouteWrite(
    write.kind === "restore" ? "restore" : "apply",
    routeInput(key.route, key),
    write,
  );
  return (
    result ?? {
      ok: false,
      kind: "refused",
      error: `Work write failed (${status})`,
      hint: "Read the Work again before retrying",
    }
  );
}
export type RouteWriteResponse = { status: number; result: RouteStateWriteResult | null };
type WorkInput = { params: { route: string }; query: Record<string, string> };

export async function postRouteWrite(
  operation: "apply" | "restore" | "start-fresh",
  input: WorkInput,
  body: unknown,
): Promise<RouteWriteResponse> {
  const response =
    operation !== "start-fresh"
      ? await peClient.response("work.apply", {
          ...input,
          body: peRoutes["work.apply"].body.parse(body),
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

/**
 * The host's accepted writes of one Work, as it stamped them (`by`, press, forward and inverse
 * patches, revision), over the one Readings stream. The host replays its retained window on every
 * (re)subscription, so an ack at or below the last one delivered is dropped here. `onGap` runs when
 * the transport reports loss, an ack cannot be read, or a delivered ack does not follow the last
 * one: acks between were missed, and a journal must stop trusting its history.
 */
export function subscribeAcceptedDeltas(
  key: WorkKey,
  onAck: (ack: WorkWriteAck) => void,
  onGap?: () => void,
  source: Readings = peReadings,
): () => void {
  let seen: number | null = null;
  return source.subscribe({ kind: "work-acks", work: key }, (frame) => {
    if (frame.kind === "gap") return onGap?.();
    if (frame.kind !== "event") return;
    const parsed = workWriteAckSchema.safeParse(frame.value);
    if (!parsed.success) return onGap?.();
    const ack = parsed.data;
    if (seen !== null && ack.revision <= seen) return;
    if (seen !== null && ack.base !== seen) onGap?.();
    seen = ack.revision;
    onAck(ack);
  });
}
