import { contextFetch as fetch } from "@pe/runtime/context";
import { z } from "zod";
import { appliedScopeSchema, type DocumentRef, type WorkKey } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";

export const familiesReads = {
  "families.read": {
    input: z.strictObject({
      filter: appliedScopeSchema,
      readId: z.uuid(),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
  },
  "families.cancel-read": { input: z.strictObject({ readId: z.uuid() }) },
} as const;
export type FamiliesReadKey = keyof typeof familiesReads;

import { familiesObservationSchema } from "@pe/agent-contracts";
export {
  familiesObservationSchema,
  familiesObservationSummarySchema,
  type FamiliesObservation,
  type FamiliesObservationSummary,
} from "@pe/agent-contracts";
/** Native matrix queries share the shell invocation door; no route owns a host client. */
export async function readFamiliesCapture(
  key: FamiliesReadKey,
  input: unknown,
  work: WorkKey,
  target?: DocumentRef,
  base = "",
) {
  if (!target) throw Error("Choose an exact project document before reading families");
  const parsed = familiesReads[key].input.parse(input);
  const response = await fetch(`${base}/families/readings`, {
    method: key === "families.cancel-read" ? "DELETE" : "POST",
    headers: {
      "content-type": "application/json",
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.openId,
    },
    body: JSON.stringify(key === "families.read" ? { work, ...parsed } : parsed),
  });
  if (!response.ok) {
    const text = await response.text();
    let reason = text;
    try {
      const body = JSON.parse(text);
      reason = typeof body.error === "string" ? body.error : (body.error?.message ?? text);
    } catch (cause) {
      throw Object.assign(Error(text || `Families query failed (${response.status})`, { cause }), {
        status: response.status,
      });
    }
    throw Object.assign(Error(reason ?? `Families query failed (${response.status})`), {
      status: response.status,
    });
  }
  const body = await response.json();
  return key === "families.read"
    ? familiesObservationSchema.parse(body)
    : z.object({ cancelled: z.literal(true) }).parse(body);
}
