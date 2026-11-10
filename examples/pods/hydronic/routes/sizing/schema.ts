import { z } from "zod";

export const key = "pod.hydronic.sizing";
export const address = `/tool/${encodeURIComponent("route:@hydronic/routes/sizing/route.artifact")}`;

/** Route-wide inputs and the chosen diameter per pipe UniqueId (nominal mm). */
export const work = z.strictObject({
  version: z.literal(1).default(1),
  maxVelocity: z.number().positive().default(1.5).meta({ title: "Max velocity (m/s)" }),
  // Firm default belongs here once a Pod can read the firm layer (gaps.json: firm-file-layer).
  maxFriction: z.number().positive().default(400).meta({ title: "Max friction (Pa/m)" }),
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
  length: z.number(), upstream: z.string().nullable(), candidate: z.number().nullable(),
  chosen: z.number().nullable(), status: z.enum(["ok", "undersized", "oversized", "no-flow"]),
});
export const value = z.object({
  limits: z.object({ maxVelocity: z.number(), maxFriction: z.number() }),
  rows: z.array(row),
  unresolved: z.array(z.object({ uniqueId: z.string(), kind: z.enum(["no-flow", "exceeds-limit", "no-catalog-size"]) })),
  pumpHead: z.object({ pa: z.number().nullable(), greyed: z.boolean() }),
});
export const args = z.object({});
