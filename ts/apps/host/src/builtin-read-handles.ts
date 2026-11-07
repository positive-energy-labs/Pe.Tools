import {
  capturesValue,
  podMemberSchema,
  parsedDocViewSchema,
  settingsSnapshotSchema,
} from "@pe/agent-contracts";
import { localRead } from "./local-inputs.ts";
import {
  familiesObservationSchema,
  workKeySchema,
  actionReceiptListDecoder,
  scheduleReadingSchema,
  scheduleCatalogSchema,
  documentRefSchema,
} from "@pe/agent-contracts";
import { z } from "zod";
import { leaf, read } from "./reads/evaluator.ts";
import { assetFile } from "./reads/inputs.ts";
import { readingRequestSchema, chatValue, openData, opsData, bindData } from "@pe/agent-contracts";
import { firmReading, catalogReading } from "./ducts-files.ts";
const resource = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) =>
  leaf("resource", input, output);
export const firm = leaf("file:firm", z.null(), firmReading);
export const catalogs = leaf("file:catalogs", z.null(), catalogReading);
// Sampling times, heartbeat and process telemetry do not change the census (ADR 0033).
// Keep null/present observation evidence, errors, process identity and all admission facts.
function machineContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(machineContent);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, value]) =>
    key === "uptimeSeconds" || key === "privateBytes" ? [] : [[key,
      key === "observedAtUtc" || key === "attemptedAtUtc" || key === "lastTickUtc"
        ? value === null ? null : true
        : machineContent(value),
    ]],
  ));
}
export const resources = {
  machine: { ...resource(readingRequestSchema, chatValue.shape.machine), content: machineContent },
  capabilities: resource(readingRequestSchema, chatValue.shape.capabilities),
  threads: resource(readingRequestSchema, openData.shape.threads),
  inventory: resource(readingRequestSchema, bindData.shape.inventory),
  recents: resource(readingRequestSchema, openData.shape.recents),
  catalog: resource(readingRequestSchema, opsData.shape.catalog),
  statuses: resource(readingRequestSchema, opsData.shape.receipts),
  receipt: resource(readingRequestSchema, opsData.shape.receipt),
};

export const familyObservation = leaf(
  "resource",
  z.object({ kind: z.literal("families-reading"), work: workKeySchema }),
  familiesObservationSchema.nullable(),
);
export const familyReceipts = leaf(
  "resource",
  z.object({ kind: z.literal("receipts"), work: workKeySchema }),
  actionReceiptListDecoder(),
);
export const scheduleCatalog = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("catalog"),
    target: documentRefSchema,
  }),
  scheduleCatalogSchema,
);
export const scheduleRetained = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("work"),
    id: z.string().min(1),
  }),
  scheduleReadingSchema.nullable(),
);
export const scheduleSaved = leaf(
  "resource",
  z.object({
    kind: z.literal("schedule-reading"),
    subject: z.literal("saved"),
    id: z.string().min(1),
  }),
  scheduleReadingSchema.nullable(),
);
export const scheduleReceipts = leaf(
  "resource",
  z.object({ kind: z.literal("receipts"), work: workKeySchema }),
  actionReceiptListDecoder(),
);
const captureList = leaf("resource", z.object({ kind: z.literal("captures") }), capturesValue);
export const captures = read("input.captures", {
  input: captureList.input,
  output: capturesValue,
  async run(ctx, args) {
    const value = await ctx.read(captureList, args);
    for (const sha of new Set(value.captures.map((row) => row.sha))) await ctx.read(assetFile, sha);
    return value;
  },
});
export const familySpec = leaf(
  "file:family-spec",
  podMemberSchema,
  z.object({ doc: parsedDocViewSchema.nullable(), error: z.string().nullable() }),
);
export const podProfile = read("input.pod-profile", {
  input: podMemberSchema,
  output: z.object({ profile: settingsSnapshotSchema.nullable(), error: z.string().nullable() }),
  async run(ctx, member) {
    try {
      const content = await ctx.read(localRead("pod.member.read"), member);
      const composed = await ctx.read(localRead("pod.member.compose"), {
        ...member,
        content: content.content,
      });
      const errors = composed.diagnostics.filter((d) => d.severity === "error");
      if (errors.length || composed.composed == null)
        throw Error(errors.map((d) => d.message).join("\n") || "The member did not compose.");
      return {
        profile: {
          member,
          sha256: content.sha256,
          rawContent: content.content,
          composedContent: composed.composed,
          dependencies: [...composed.dependencies],
          validation: { isValid: true, issues: [] },
        },
        error: null,
      };
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
