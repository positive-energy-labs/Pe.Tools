/**
 * /ducts Work: a person's assumptions that make a duct network solvable. Nothing here writes to
 * Revit; the network itself is read from `ducts.snapshot`. One segment, `assumptions`, keyed by
 * what the assumption is about:
 * - an issue id from the snapshot (`open-end:g123:456:1`) holds a verdict;
 * - `flex-roughness:<flex type>`, `fan-static:<equipment id>`, `component-drop:<family>` hold overrides.
 * Pea proposes; a person stages.
 */
import { z } from "zod";

import { type RouteStateSpec } from "./route-state.ts";
import { trichotomyCellSchema } from "./trichotomy.ts";

export const ductAssumptionSchema = z.discriminatedUnion("kind", [
  /** capped: the open end carries no flow; connect: it must be connected in the model; ignore: leave it out. */
  z.strictObject({ kind: z.literal("verdict"), verdict: z.enum(["capped", "connect", "ignore"]) }),
  z.strictObject({ kind: z.literal("flex-roughness"), ft: z.number().positive() }),
  z.strictObject({ kind: z.literal("fan-static"), inWg: z.number().nonnegative() }),
  z.strictObject({ kind: z.literal("component-drop"), inWg: z.number().nonnegative() }),
]);
export type DuctAssumption = z.infer<typeof ductAssumptionSchema>;

const OVERRIDES = ["flex-roughness", "fan-static", "component-drop"] as const;
export type DuctOverrideKind = (typeof OVERRIDES)[number];

/** The cell key of an override: `<kind>:<subject>`. Any other key is an issue id and holds a verdict. */
export const ductOverrideKey = (kind: DuctOverrideKind, subject: string | number) =>
  `${kind}:${subject}`;
const kindOfKey = (key: string): DuctAssumption["kind"] => {
  const head = key.slice(0, key.indexOf(":"));
  return (OVERRIDES as readonly string[]).includes(head) ? (head as DuctOverrideKind) : "verdict";
};

export const ductsDocumentSchema = z
  .strictObject({
    assumptions: z.record(z.string(), trichotomyCellSchema(ductAssumptionSchema)).default({}),
  })
  .superRefine((doc, ctx) => {
    for (const [key, cell] of Object.entries(doc.assumptions))
      for (const rung of ["proposal", "staged"] as const) {
        const value = cell[rung]?.value;
        if (value && value.kind !== kindOfKey(key))
          ctx.addIssue({
            code: "custom",
            path: ["assumptions", key, rung, "value"],
            message: `the key ${key} holds a ${kindOfKey(key)}, not a ${value.kind}`,
          });
      }
  });
export type DuctsRouteDocument = z.infer<typeof ductsDocumentSchema>;

export const ductsRouteState = {
  route: "ducts",
  title: "Ducts",
  description:
    "A person's assumptions that make duct networks solvable, one cell per key: an issue id from ducts.snapshot holds a verdict (capped, connect, ignore); flex-roughness:<flex type> (ft), fan-static:<equipment id> (in-wg) and component-drop:<family> (in-wg) hold overrides. Pea may propose; a person stages. Nothing is written to Revit.",
  schema: ductsDocumentSchema,
  agentWriteMask: [["assumptions", "*", "proposal"]],
  commands: {},
} satisfies RouteStateSpec<typeof ductsDocumentSchema>;
