import { z } from "zod";
import {
  appliedScopeSchema,
  documentRefSchema,
  familiesReadProgressSchema,
  workKeySchema,
  type DocumentRef,
  type WorkKey,
} from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
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

export const familiesObservationSchema = z.object({
  id: z.string(),
  work: workKeySchema,
  document: documentRefSchema,
  documentTitle: z.string().optional(),
  filter: appliedScopeSchema,
  capturedAt: z.string(),
  completedAt: z.string(),
  envelope: z.object({ revision: z.number().int() }).optional(),
  progress: familiesReadProgressSchema.optional(),
  readback: z
    .object({
      sourceId: z.string(),
      verifiedFamilies: z.array(z.object({ name: z.string(), at: z.string() })),
    })
    .optional(),
  result: z.custom<RevitMatrixLoadedFamilies.Res.Response>(),
});
export type FamiliesObservation = z.output<typeof familiesObservationSchema>;
export type FamiliesObservationSummary = Omit<FamiliesObservation, "result"> & {
  familyCount: number;
  typeCount: number;
  issueCount: number;
};

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
  const body = await response.json();
  if (!response.ok) {
    const reason = typeof body.error === "string" ? body.error : body.error?.message;
    throw Object.assign(Error(reason ?? `Families query failed (${response.status})`), {
      status: response.status,
    });
  }
  return key === "families.read"
    ? familiesObservationSchema.parse(body)
    : z.object({ cancelled: z.literal(true) }).parse(body);
}
