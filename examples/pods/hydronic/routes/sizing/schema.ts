import { z } from "zod";
import { goalSchema } from "@pe/agent-contracts/slots";

export const key = "pod.hydronic.sizing";
export const address = `/tool/${encodeURIComponent("route:@hydronic/routes/sizing/route.artifact")}`;

/** Route-wide inputs and the chosen diameter per pipe UniqueId (nominal mm). */
export const work = z.strictObject({
  version: z.literal(1).default(1),
  maxVelocity: z.number().positive().default(1.5).meta({ title: "Max velocity (m/s)" }),
  // Absent: the firm file's limit (Firm/hydronic.json), else 400.
  maxFriction: z.number().positive().optional().meta({ title: "Max friction (Pa/m)" }),
  chosen: z.record(z.string(), z.number().positive()).default({}).meta({ title: "Chosen diameter" }),
});
export const workState = {
  route: key,
  title: "Hydronic pipe sizing",
  description: "Velocity and friction limits and the chosen diameter per pipe",
  schema: work,
  schemaVersion: 1,
};
export const edit = work.omit({ version: true }).partial();

const row = z.object({
  uniqueId: z.string(), label: z.string(), flow: z.number().nullable(), diameter: z.number(),
  length: z.number(), upstream: z.string().nullable(), segment: z.string().nullable(), candidate: z.number().nullable(),
  chosen: z.number().nullable(), status: z.enum(["ok", "undersized", "oversized", "no-flow"]),
});
export const limits = z.object({ maxVelocity: z.number(), maxFriction: z.number() });
/** The firm layer's shape and its seed (ADR 0026): what a firm file may set for every job. */
export const firmLimits = z.strictObject({ maxFriction: z.number().positive() });
export const sizing = z.object({
  limits,
  rows: z.array(row),
  unresolved: z.array(z.object({ uniqueId: z.string(), kind: z.enum(["no-flow", "exceeds-limit", "no-catalog-size"]) })),
  pumpHead: z.object({ pa: z.number().nullable(), greyed: z.boolean() }),
});
/** The core is the Goal (ADR 0030 rule 3): the unresolved list first, the sizing as its answer. */
export const value = goalSchema(sizing);
/** One piping system by UniqueId; empty sizes the document's first piping system. */
export const args = z.object({ system: z.string() });
