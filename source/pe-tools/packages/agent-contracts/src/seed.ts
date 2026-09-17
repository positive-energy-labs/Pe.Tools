/**
 * Seed — one moment of a route, Layer-free: the Work it starts from, a value per Reading key, a
 * partial Page, and an optional injected failure. A Seed is what `?demo=<action>` mounts in an
 * isolated owner, and what the inspector exports.
 */
import { z } from "zod";
import { addressSchema, executionTargetSchema, type ExecutionTarget } from "./target.ts";
import { workKeySchema } from "./route-state.ts";
import { familiesRouteState } from "./families.ts";
import { parameterLinkProfileSchema, parameterLinksRouteState } from "./parameter-links.ts";
import { settingsRouteState, podMemberSchema } from "./settings.ts";
import {
  takeoffsRouteState,
  takeoffSnapshotSchema,
  candidateRegionSchema,
  partitionRunSchema,
} from "./takeoffs.ts";
import { familyCaptureSchema } from "./family-actions.ts";

/** One moment of a route: section 3 of the route-primitive spec. */
export interface Seed<W, R extends string, P> {
  title: string;
  /** Explicit synthetic authority for this moment. Absent seeds are host-only. */
  target?: ExecutionTarget;
  work: W;
  readings: Partial<Record<R, unknown>>;
  page: Partial<P>;
  /** Failure injection for the demo lane: the action that refuses, and what it says. */
  failure?: { action: string; message: string };
}

/** The wire shape of a Seed. Work and Page are the route's own schemas at the call site. */
export const seedSchema = z.object({
  title: z.string().min(1),
  target: executionTargetSchema.optional(),
  work: z.unknown(),
  readings: z.record(z.string(), z.unknown()).default({}),
  page: z.record(z.string(), z.unknown()).default({}),
  failure: z.object({ action: z.string().min(1), message: z.string().min(1) }).optional(),
});
export type SeedWire = z.infer<typeof seedSchema>;

const failure = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.enum(["read", "refusal", "unknown"]),
    message: z.string(),
    original: z.unknown(),
  }),
]);
const common = {
  version: z.literal(1),
  namespace: z.literal("isolated-demo"),
  seedAddress: addressSchema,
  failure,
  /** Original addresses, tokens, IDs and unknown receipts are citations, never executable authority. */
  originalEvidence: z.unknown(),
};
const file = z.object({
  member: podMemberSchema,
  rawContent: z.string(),
});
export const demoSeedSchema = z.discriminatedUnion("route", [
  z.object({
    ...common,
    route: z.literal("takeoffs"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: takeoffsRouteState.schema,
    }),
    readings: z.object({
      snapshot: takeoffSnapshotSchema,
      afterAdopt: takeoffSnapshotSchema.optional(),
      partition: partitionRunSchema.optional(),
      afterPartition: takeoffSnapshotSchema.optional(),
      /** Versioned supplied facts, never a real file, checksum, writer or imported destination. */
      rhvac: z
        .object({
          sample: z.literal("rectangular-room-v1"),
          state: z.enum(["before", "after", "missing-system"]),
          simulated: z.literal(true),
        })
        .optional(),
      candidates: z.array(candidateRegionSchema),
    }),
    page: z.looseObject({
      actionInput: z.string().optional(),
      views: z.array(z.string()),
      zones: z.array(z.string()),
      dir: z.string(),
      r10: z.string(),
      stage: z.enum(["adopt", "audit", "sync"]),
    }),
    files: z.array(file),
  }),
  z.object({
    ...common,
    route: z.literal("family"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: settingsRouteState.schema,
    }),
    readings: z.object({
      captures: z.array(familyCaptureSchema),
      files: z.array(file).min(1),
      preparePlan: z.boolean().optional(),
    }),
    page: z.looseObject({
      actionInput: z.string().optional(),
      inputBuffer: z.unknown().nullable(),
      armed: z.boolean(),
    }),
    scenario: z.enum([
      "success",
      "token-conflict",
      "publication-refusal",
      "native-unknown",
      "plan-refusal",
      "stale-plan",
    ]),
  }),
  z.object({
    ...common,
    route: z.literal("families"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: familiesRouteState.schema,
    }),
    /** File-free: the profile the demo plans against is supplied as parsed JSON, never a path. */
    readings: z.object({
      profile: z.record(z.string(), z.unknown()),
      families: z.array(z.string()).min(1),
      preparePlan: z.boolean().optional(),
    }),
    page: z.looseObject({ actionInput: z.string().optional(), armed: z.boolean() }),
    scenario: z
      .enum(["success", "plan-refusal", "stale-basis", "native-unknown"])
      .default("success"),
  }),
  z.object({
    ...common,
    route: z.literal("parameter-links"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: parameterLinksRouteState.schema,
    }),
    readings: z.object({
      stored: parameterLinkProfileSchema.nullish(),
      changedWriteCount: z.number().int().nonnegative().default(2),
      blockingIssue: z.boolean().default(false),
      prepareEvaluation: z.boolean().optional(),
    }),
    page: z.looseObject({ actionInput: z.string().optional(), armed: z.boolean() }),
    scenario: z.enum(["success", "stale-basis", "native-unknown"]).default("success"),
  }),
  z.object({
    ...common,
    route: z.literal("chat"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: z.unknown(),
    }),
    readings: z.looseObject({
      messages: z.array(z.unknown()),
      display: z.record(z.string(), z.unknown()),
    }),
    page: z.object({}),
  }),
]);
export type DemoSeed = z.infer<typeof demoSeedSchema>;
export type DemoExport =
  | { kind: "complete"; seed: DemoSeed }
  | { kind: "incomplete"; missing: string[] };

/** Tag every container, so an original object cannot masquerade as a codec tag. */
function encode(value: unknown): unknown {
  if (value === undefined) return ["undefined"];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (value instanceof Map) return ["map", [...value].map(([k, v]) => [encode(k), encode(v)])];
  if (value instanceof Set) return ["set", [...value].map(encode)];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (value && typeof value === "object")
    return ["object", Object.entries(value).map(([k, v]) => [k, encode(v)])];
  return ["scalar", value];
}
function decode(value: unknown): unknown {
  const [tag, payload] = z.tuple([z.string(), z.unknown().optional()]).parse(value);
  if (tag === "undefined") return undefined;
  if (tag === "scalar")
    return z.union([z.string(), z.number(), z.boolean(), z.null()]).parse(payload);
  if (tag === "date") return new Date(z.iso.datetime().parse(payload));
  const entries = z.array(z.unknown()).parse(payload);
  if (tag === "array") return entries.map(decode);
  if (tag === "set") return new Set(entries.map(decode));
  if (tag === "map")
    return new Map(
      entries.map((entry) => {
        const [k, v] = z.tuple([z.unknown(), z.unknown()]).parse(entry);
        return [decode(k), decode(v)];
      }),
    );
  if (tag === "object")
    return Object.fromEntries(
      entries.map((entry) => {
        const [k, v] = z.tuple([z.string(), z.unknown()]).parse(entry);
        return [k, decode(v)];
      }),
    );
  throw Error(`Unsupported seed codec tag: ${tag}`);
}
export const exportSeed = (seed: DemoSeed) => JSON.stringify(encode(demoSeedSchema.parse(seed)));
export const importSeed = (text: string): DemoSeed =>
  demoSeedSchema.parse(decode(JSON.parse(text)));
export const demoExportWireSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete"), seed: z.string().transform(importSeed) }),
  z.object({ kind: z.literal("incomplete"), missing: z.array(z.string()).min(1) }),
]);
