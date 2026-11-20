import { documentRefSchema } from "@pe/agent-contracts/target";
import { z } from "zod";
import { DUCT_PARAMETER_KEYS } from "./duct-inputs.ts";

export const DUCTS_IDS_PER_READ = 4096;

/** Selectors bound acquisition by document, system, element ids or connector walk. */
export const ductsSnapshotSelectorSchema = z.discriminatedUnion("kind", [
  /** The fan roster's read: every HVAC equipment node and air terminal, and Revit's systems without sections. Health without open-end neighbourhoods (as `ids`). */
  z.strictObject({ kind: z.literal("roster") }),
  z.strictObject({
    kind: z.literal("ids"),
    ids: z.array(z.number().int()).min(1).max(DUCTS_IDS_PER_READ),
  }),
  /** The named Revit systems' groups, whole, in the document read's cooked shape: the network page's read. */
  z.strictObject({
    kind: z.literal("systems"),
    systemIds: z.array(z.number().int()).min(1).max(32),
  }),
  z.strictObject({
    kind: z.literal("from"),
    unitId: z.number().int(),
    portIndex: z.number().int().optional(),
    maxHops: z.number().int().positive().optional(),
    /** Open-end candidate box in inches (C# default 36): the walk's box side and model health's neighbourhood. */
    candidateBoxIn: z.number().positive().optional(),
    /** Model health's auto-join gap in inches (C# default 3). */
    autoJoinGapIn: z.number().nonnegative().optional(),
  }),
]);
export type DuctsSnapshotSelector = z.infer<typeof ductsSnapshotSelectorSchema>;

/** Acquisition inputs, independent of a route's local selection and staged calculations. */
export const ductsSnapshotReadingSchema = z.strictObject({
  kind: z.literal("ducts-snapshot"),
  target: documentRefSchema,
  slots: z
    .partialRecord(z.enum(DUCT_PARAMETER_KEYS), z.string().nullable())
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
  labelParameter: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
  /** Explicit roster or bounded geometry subject. */
  selector: ductsSnapshotSelectorSchema,
});
export type DuctsSnapshotReading = z.infer<typeof ductsSnapshotReadingSchema>;
export const ductsTablesReadingSchema = z.strictObject({
  kind: z.literal("ducts-tables"),
  session: z.string().min(1),
  ids: z.array(z.string()).max(256),
});
export type DuctsTablesReading = z.infer<typeof ductsTablesReadingSchema>;
export const ductsReadingSchema = z.discriminatedUnion("kind", [
  ductsSnapshotReadingSchema,
  ductsTablesReadingSchema,
]);
export type DuctsReadingRequest = z.infer<typeof ductsReadingSchema>;
export const ductsReadingCallPolicies = {
  "ducts.snapshot.roster": { canonicalSession: true, reading: "roster" },
  "ducts.snapshot.walk": { canonicalSession: true, reading: "walk" },
  "ducts.tables": { canonicalSession: true, reading: "tables" },
} as const;
export const ductsReadingEnvelopeSchema = z.strictObject({
  revision: z.string(),
  state: z.enum(["idle", "loading", "ready", "stale", "failed", "closed"]),
  version: z.string().nullable(),
  target: documentRefSchema.nullable(),
  session: z.string(),
  error: z.string().optional(),
});
export type DuctsReadingEnvelope = z.infer<typeof ductsReadingEnvelopeSchema>;
export const DUCTS_REFRESH_HEADER = "x-pe-ducts-refresh";

declare module "@pe/agent-contracts" {
  interface ProductReadings {
    ducts: DuctsReadingRequest;
  }
}
