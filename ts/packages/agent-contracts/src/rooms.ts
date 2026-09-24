/**
 * /rooms: Room Regions (Revit Filled Regions on a plan view carrying the takeoff spine) and the
 * seven room fields plus type on each. Wire authority is `.artifacts/handoffs/2026-09-24-rooms-contract.md`.
 * SHIM: generated rooms ops land at merge; the op response schemas below are hand-written to that
 * contract and are replaced by the generated catalog.
 */
import { z } from "zod";

import { type RouteStateSpec } from "./route-state.ts";
import { roomEditSchema, type RoomEdit, type RoomEditField } from "./takeoffs.ts";
import { trichotomyCellSchema, type TrichotomyCellLike } from "./trichotomy.ts";

const point = z.tuple([z.number(), z.number()]);
const loop = z.array(point);
const measured = z.number().nullable();

export const roomsRegionSchema = z.object({
  elementId: z.number(),
  guid: z.string(),
  view: z.string(),
  level: z.string(),
  role: z.enum(["room", "held"]),
  name: z.string(),
  /** What Revit holds; untrusted, so any string, never narrowed to the enum on read. */
  type: z.string(),
  ceilingFt: measured,
  people: measured,
  lightingW: measured,
  equipSensible: measured,
  equipLatent: measured,
  ventilationCfm: measured,
  sqft: z.number(),
  outer: loop,
  holes: z.array(loop),
  label: point,
  runId: z.string(),
  reason: z.string().nullable(),
  touched: z.boolean(),
  locked: z.boolean(),
  stale: z.boolean(),
});
export type RoomsRegion = z.infer<typeof roomsRegionSchema>;

/** `rooms.snapshot` (Read): every level with its plan views, and every Room Region. */
export const roomsSnapshotSchema = z.object({
  levels: z.array(
    z.object({ name: z.string(), elevation: z.number(), views: z.array(z.string()) }),
  ),
  regions: z.array(roomsRegionSchema),
});
export type RoomsSnapshot = z.infer<typeof roomsSnapshotSchema>;

/** `rooms.partition` result. */
export const roomsPartitionResultSchema = z.object({
  level: z.string(),
  runId: z.string(),
  created: z.number(),
  kept: z.number(),
  locked: z.number(),
  deleted: z.number(),
  held: z.number(),
  failures: z.array(z.string()),
  hold: z.string().nullable(),
  ms: z.number(),
});
export type RoomsPartitionResult = z.infer<typeof roomsPartitionResultSchema>;

/** `rooms.write` result. */
export const roomsWriteResultSchema = z.object({ written: z.number() });

/** The fields a row edits, in table order: the type, then the seven carriers. */
export const ROOMS_FIELDS = Object.keys(roomEditSchema.shape) as RoomEditField[];

/** One canonical JSON tuple per cell address: `[guid, field]`. */
export const roomEditKey = (guid: string, field: RoomEditField) => JSON.stringify([guid, field]);
const addressOf = (key: string): { guid: string; field: RoomEditField } | null => {
  try {
    const parts = JSON.parse(key) as unknown;
    return Array.isArray(parts) &&
      parts.length === 2 &&
      parts.every((part) => typeof part === "string") &&
      JSON.stringify(parts) === key
      ? { guid: parts[0], field: parts[1] as RoomEditField }
      : null;
  } catch {
    return null;
  }
};
export const roomEditAddress = (key: string) => {
  const address = addressOf(key);
  if (!address) throw Error(`not a rooms edit key: ${key}`);
  return address;
};

export const roomsDocumentSchema = z
  .strictObject({
    edits: z
      .record(
        z.string().refine((key) => addressOf(key) !== null, {
          error: "a rooms edit cell key must be a canonical JSON [guid, field] tuple",
        }),
        trichotomyCellSchema(z.union([z.string(), z.number()])),
      )
      .default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.edits)) {
      const { field } = roomEditAddress(key);
      const schema = (roomEditSchema.shape as Record<string, z.ZodOptional<z.ZodType>>)[field];
      if (!schema) {
        ctx.addIssue({ code: "custom", path: ["edits", key], message: `no room field '${field}'` });
        continue;
      }
      for (const rung of ["proposal", "staged"] as const) {
        const value = (cell as TrichotomyCellLike)[rung]?.value;
        if (value !== undefined && !schema.unwrap().safeParse(value).success)
          ctx.addIssue({
            code: "custom",
            path: ["edits", key, rung, "value"],
            message: `not a ${field} value`,
          });
      }
    }
  });
export type RoomsRouteDocument = z.infer<typeof roomsDocumentSchema>;

/** One `rooms.write` region per guid with staged cells: the staged values only, never proposals. */
export function stagedRoomWrites(doc: RoomsRouteDocument): ({ guid: string } & RoomEdit)[] {
  const regions = new Map<string, { guid: string } & RoomEdit>();
  for (const [key, cell] of Object.entries(doc.edits)) {
    if (cell.staged?.value === undefined) continue;
    const { guid, field } = roomEditAddress(key);
    const region = regions.get(guid) ?? regions.set(guid, { guid }).get(guid)!;
    (region as Record<string, unknown>)[field] = cell.staged.value;
  }
  return [...regions.values()];
}

export const roomsRouteState = {
  route: "rooms",
  title: "Rooms",
  description:
    "A person's staged room fields (name, type, ceiling, people, lighting, equipment, ventilation), one cell per [region guid, field]. Pea may propose; a person stages, and rooms.write reads staged values only. Regions and geometry are read from rooms.snapshot.",
  schema: roomsDocumentSchema,
  agentWriteMask: [["edits", "*", "proposal"]],
  commands: {},
} satisfies RouteStateSpec<typeof roomsDocumentSchema>;
