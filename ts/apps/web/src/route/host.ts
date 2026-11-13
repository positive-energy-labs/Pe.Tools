import { peClient } from "#/host/pe-client";
import { peReadings, type Readings } from "#/host/resource-stream";
import {
  workWriteAckSchema,
  workTimelineSchema,
  WORK_TIMELINE_READ,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWriteAck,
  type WorkWrite,
} from "@pe/agent-contracts";
import { peRoutes } from "@pe/agent-contracts/pe-api";
import { FINDINGS_OWNER, findingsWorkSchema, type Finding } from "@pe/agent-contracts/slots";
import { z } from "zod";
import type { WorkAdmission } from "./route-discovery";
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
  invocation?: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationBasis,
): Promise<RouteStateWriteResult> {
  const { result, status } = await postRouteWrite(
    routeInput(key.route, key),
    { ...write, ...(invocation?.causalParent ? { causalParent: invocation.causalParent } : {}) },
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

/**
 * The person's undo of their own last finding (ADR 0035 rule 9): the findings Work's history door
 * at its current revision. The host takes the author from the caller, so Pea's findings stay.
 */
export async function undoOwnFinding(
  key: WorkKey,
  client: Pick<typeof peClient, "response"> = peClient,
): Promise<{ message: string } | null> {
  // The host Timeline's step door (ADR 0042): read the step it offers this caller for the findings
  // Work alone, then send it back. k2/journal-delete replaces this path with the mount's Timeline.
  const findings = { ...key, route: FINDINGS_OWNER };
  const read = {
    read: WORK_TIMELINE_READ,
    args: { works: [findings] },
    subscription: `undo-finding-${crypto.randomUUID()}`,
    generation: 0,
  };
  const shown = await client.response("reads.value", { body: read });
  void client.response("reads.value", { body: { ...read, release: true } }).catch(() => {});
  const timeline = shown.ok
    ? workTimelineSchema.safeParse(((await shown.json()) as { value?: { data?: unknown } | null }).value?.data).data
    : undefined;
  if (!timeline?.undo) return { message: timeline?.refusal.undo ?? "No findings on this document to undo" };
  const response = await client.response("work.history", {
    ...routeInput(FINDINGS_OWNER, findings),
    body: { direction: "undo", works: [findings], expected: timeline.undo },
  });
  const wire = (await response.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
  return response.ok && wire?.ok !== false
    ? null
    : { message: String(wire?.error ?? `Undo failed (${response.status})`) };
}

/** This document's findings, as the host's findings Work holds them; none before the first is written, null when unread. */
export async function readFindings(
  key: WorkKey,
  client: Pick<typeof peClient, "response"> = peClient,
): Promise<readonly Finding[] | null> {
  const read = await client.response("work.get", routeInput(FINDINGS_OWNER, { ...key, route: FINDINGS_OWNER }));
  if (read.status === 404) return [];
  const doc = read.ok ? z.object({ doc: findingsWorkSchema }).safeParse(await read.json()).data?.doc : undefined;
  return doc ? Object.values(doc.findings) : null;
}

/** How many of this document's findings a person wrote; null when unread. */
export const ownFindingsLeft = async (key: WorkKey, client?: Pick<typeof peClient, "response">): Promise<number | null> =>
  (await readFindings(key, client))?.filter((finding) => finding.by === "person").length ?? null;

export type RouteWriteResponse = { status: number; result: RouteStateWriteResult | null };
type WorkInput = { params: { route: string }; query: Record<string, string> };

export async function postRouteWrite(
  input: WorkInput,
  body: unknown,
): Promise<RouteWriteResponse> {
  const response = await peClient.response("work.apply", {
    ...input, body: peRoutes["work.apply"].body.parse(body),
  });
  const wire = await response.json().catch((error) => {
    console.error("host: asynchronous operation failed", error);
    return null;
  });
  return { status: response.status, result: response.ok ? wire : (wire?.error?.details ?? null) };
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
  admission?: WorkAdmission,
): () => void {
  let seen: number | null = null;
  return source.subscribe(
    { kind: "work-acks", work: key, ...(admission && { admission }) },
    (frame) => {
      if (frame.kind === "gap") return onGap?.();
      if (frame.kind !== "event") return;
      const parsed = workWriteAckSchema.safeParse(frame.value);
      if (!parsed.success) return onGap?.();
      const ack = parsed.data;
      if (seen !== null && ack.revision <= seen) return;
      if (seen !== null && ack.base !== seen) onGap?.();
      seen = ack.revision;
      onAck(ack);
    },
  );
}
