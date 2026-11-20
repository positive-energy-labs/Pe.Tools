import { z } from "zod";
import { addressSchema, podMemberSchema, workKeySchema } from "@pe/agent-contracts";
import {
  takeoffSnapshotSchema,
  candidateRegionSchema,
  partitionRunSchema,
} from "@pe/rooms-contract/takeoffs";

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
const file = z.object({ member: podMemberSchema, rawContent: z.string() });
const demoSeedSchema = <S extends z.ZodType>(takeoffs: S) =>
  z.object({
    ...common,
    route: z.literal("takeoffs"),
    work: z.object({
      key: workKeySchema,
      revision: z.number().int().nonnegative(),
      candidate: takeoffs,
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
  });

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
/** Round-trip the recorded seed against the product's declared Work. */
export function demoSeedCodec<S extends z.ZodType>(takeoffsWork: { readonly schema: S }) {
  const schema = demoSeedSchema(takeoffsWork.schema);
  const importSeed = (text: string) => schema.parse(decode(JSON.parse(text)));
  return {
    exportSeed: (seed: z.input<typeof schema>) => JSON.stringify(encode(schema.parse(seed))),
    importSeed,
  };
}
