import { z } from "zod";
import { actionReceiptSchema, nativeProcessSchema } from "./action-receipts.ts";
import { documentRefSchema } from "./target.ts";

const uuid = z.uuid();
const token = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/);
const count = z.number().int().nonnegative();
const milliseconds = z.number().finite().nonnegative();
export const receiptComponentSchema = z.enum(["host", "web", "revit", "pea", "tray", "installer"]);
export const receiptStampSchema = z
  .strictObject({
    installId: uuid,
    processSessionId: uuid,
    component: receiptComponentSchema,
    lane: z.enum(["dev", "installed"]),
    version: token,
    build: token,
    commit: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .readonly();
export type ReceiptStamp = z.infer<typeof receiptStampSchema>;
export const receiptJoinSchema = z
  .strictObject({
    actionId: uuid.optional(),
    requestId: uuid,
    parentRequestId: uuid.optional(),
    browserSessionId: uuid.optional(),
    threadId: uuid.optional(),
    turnId: uuid.optional(),
  })
  .readonly();
export type ReceiptJoin = z.infer<typeof receiptJoinSchema>;

export const receiptFaultCodeSchema = z.enum([
  "reading.timeout",
  "reading.failed",
  "stream.failed",
  "host.failed",
  "host.unreachable",
  "pane.failed",
  "parts.failed",
  "native.failed",
  "turn.failed",
  "mcp.failed",
  "update.failed",
  "telemetry.dropped",
  "telemetry.persistence-failed",
  "identity.unavailable",
  "process.uncaught",
  "process.unhandled-rejection",
  "bridge.failed",
]);
export type ReceiptFaultCode = z.infer<typeof receiptFaultCodeSchema>;
export const receiptEvidenceRefSchema = z.strictObject({
  path: z.string().min(1),
  target: documentRefSchema.optional(),
});
export const exactSdkReceiptRefSchema = z.strictObject({
  requestId: uuid,
  key: z.string().min(1),
  process: nativeProcessSchema,
  target: documentRefSchema.optional(),
});
export const nativeVerdictSchema = z.enum([
  "missing",
  "running",
  "ok",
  "failed",
  "cancelled",
  "rejected",
  "abandoned",
  "unknown",
]);
const outcome = z.enum(["succeeded", "failed", "cancelled", "unknown", "incomplete", "refused"]);
export const receiptUsageEventSchema = z.enum([
  "app_boot",
  "version_mismatch",
  "host_op",
  "ribbon_click",
  "palette_action",
  "reading_timeout",
  "reading_failure",
  "stream_fault",
  "host_fault",
  "telemetry_dropped",
  "refusal_count",
  "update_outcome",
  "$exception",
]);
/** Closed field names; registry-valued labels are validated again by the export owner. */
export const receiptCountersSchema = z.strictObject({
  count: count.optional(),
  durationMs: milliseconds.optional(),
  elapsedMs: milliseconds.optional(),
  toolCount: count.optional(),
  status: z.number().int().min(100).max(599).optional(),
  outcome: outcome.optional(),
  faultCode: receiptFaultCodeSchema.optional(),
  op: token.optional(),
  originClass: z.enum(["human", "pea", "page", "external", "system"]).optional(),
  tsOnly: z.boolean().optional(),
  revitVersion: token.optional(),
  hostVersion: token.optional(),
  commandCode: token.optional(),
  palette: token.optional(),
  tab: token.optional(),
  itemKind: token.optional(),
  mode: token.optional(),
  readingKind: token.optional(),
  streamKind: token.optional(),
  routeCode: token.optional(),
  reasonCode: token.optional(),
  phase: z
    .enum(["started", "finished", "failed", "available", "applying", "restarting"])
    .optional(),
  candidateVersion: token.optional(),
  producer: receiptComponentSchema.optional(),
});
export const safeMcpMetadataSchema = z.strictObject({
  sessionId: uuid.optional(),
  source: z.literal("server"),
  toolName: token.optional(),
  durationMs: milliseconds.optional(),
  isError: z.boolean().optional(),
  inputKeys: z.array(token).max(64).optional(),
  clientName: token.optional(),
  clientVersion: token.optional(),
  protocolVersion: token.optional(),
  serverName: token,
  serverVersion: token,
  serverBuild: token,
  faultCode: receiptFaultCodeSchema.optional(),
});
const diagnosticReceipt = z.strictObject({
  kind: z.literal("diagnostic"),
  code: receiptFaultCodeSchema,
  elapsedMs: milliseconds.optional(),
  localRef: receiptEvidenceRefSchema.optional(),
  readingKind: token.optional(),
  streamKind: token.optional(),
  routeCode: token.optional(),
});
const usageReceipt = z.strictObject({
  kind: z.literal("usage"),
  event: receiptUsageEventSchema,
  counters: receiptCountersSchema,
});
export const receiptBodySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action"), value: actionReceiptSchema }),
  z.strictObject({
    kind: z.literal("queue"),
    op: z.string().min(1),
    phase: z.enum(["queued", "started"]),
    depth: z.number().int().positive(),
    waitMs: milliseconds.optional(),
    processSessionId: uuid,
  }),
  z.strictObject({
    kind: z.literal("native"),
    verdict: nativeVerdictSchema,
    localRef: exactSdkReceiptRefSchema,
  }),
  z.strictObject({
    kind: z.literal("turn"),
    phase: z.enum(["started", "finished", "failed"]),
    code: receiptFaultCodeSchema.optional(),
    durationMs: milliseconds.optional(),
    toolCount: count.optional(),
  }),
  z.strictObject({
    kind: z.literal("permission"),
    phase: z.enum(["asked", "resolved"]),
    localRef: z.strictObject({ threadId: z.string().min(1), eventId: z.string().min(1) }),
  }),
  diagnosticReceipt,
  usageReceipt,
  z.strictObject({
    kind: z.literal("mcp"),
    event: z.enum(["$mcp_tool_call", "$mcp_initialize", "$exception"]),
    metadata: safeMcpMetadataSchema,
  }),
  z.strictObject({
    kind: z.literal("feedback"),
    explicitHumanSubmit: z.literal(true),
    localRef: receiptEvidenceRefSchema.extend({ feedbackId: uuid }),
  }),
]);
export type ReceiptBody = z.infer<typeof receiptBodySchema>;
export type ReceiptFact = Exclude<ReceiptBody, { kind: "action" }>;
/** Native Event payload; it cannot claim the host's installation, process identity or lane. */
export const receiptProducerSchema = z.strictObject({
  schema: z.literal(1),
  id: uuid,
  at: z.iso.datetime(),
  join: z.strictObject({ requestId: uuid }),
  body: z.discriminatedUnion("kind", [usageReceipt, diagnosticReceipt]),
  emitter: z.strictObject({
    version: z.string().max(128).nullable(),
    build: z.string().max(128).nullable(),
    commit: z.string().max(128).nullable(),
  }),
});
export type ReceiptProducer = z.infer<typeof receiptProducerSchema>;
export const receiptSchema = z
  .strictObject({
    schema: z.literal(1),
    id: uuid,
    revision: z.number().int().positive(),
    at: z.iso.datetime(),
    // Historical/local-only evidence has no admitted emitter identity. Never backfill it with
    // the current host's build. Export requires a non-null stamp.
    stamp: receiptStampSchema.nullable(),
    join: receiptJoinSchema,
    body: receiptBodySchema,
  })
  .refine(
    (r) => r.body.kind !== "native" || r.body.localRef.requestId === r.join.requestId,
    "Native receipt joins must retain the exact SDK request UUID",
  )
  .readonly();
export type Receipt = z.infer<typeof receiptSchema>;
export const receiptQuerySchema = z.strictObject({
  kinds: z
    .array(
      z.enum([
        "action",
        "queue",
        "native",
        "turn",
        "permission",
        "diagnostic",
        "usage",
        "mcp",
        "feedback",
      ]),
    )
    .optional(),
  actionId: uuid.optional(),
  requestId: uuid.optional(),
  threadId: uuid.optional(),
  after: z.iso.datetime().optional(),
});
export type ReceiptQuery = z.infer<typeof receiptQuerySchema>;
export interface ReceiptReader {
  read(query: ReceiptQuery): Promise<Receipt[]>;
  /** Future committed revisions only. Read plus subscribe consumers dedupe by id/revision. */
  subscribe(query: ReceiptQuery, consume: (receipt: Receipt) => void): () => void;
}
export function receiptMatches(receipt: Receipt, query: ReceiptQuery): boolean {
  return (
    (!query.kinds || query.kinds.includes(receipt.body.kind)) &&
    (!query.actionId || receipt.join.actionId === query.actionId) &&
    (!query.requestId || receipt.join.requestId === query.requestId) &&
    (!query.threadId || receipt.join.threadId === query.threadId) &&
    (!query.after || receipt.at > query.after)
  );
}

/** Portable conformance vector: native producers use this exact wire casing and event spelling. */
export const receiptGoldenEnvelope: Receipt = receiptSchema.parse({
  schema: 1,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  at: "2026-10-13T15:00:00.000Z",
  stamp: {
    installId: "10000000-0000-4000-8000-000000000002",
    processSessionId: "10000000-0000-4000-8000-000000000003",
    component: "revit",
    lane: "dev",
    version: "0.7.22",
    build: "0.7.22.1",
    commit: "0123456789abcdef0123456789abcdef01234567",
  },
  join: { requestId: "10000000-0000-4000-8000-000000000004" },
  body: { kind: "usage", event: "app_boot", counters: { revitVersion: "2025" } },
});
