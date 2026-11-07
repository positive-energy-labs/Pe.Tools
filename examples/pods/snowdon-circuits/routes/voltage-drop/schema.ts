import { z } from "zod";
import { sizes } from "../../pages/tour/calc.mjs";
export const key = "pod.snowdon-circuits.voltage-drop";
export const initial = { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" } as const;
export const inputs = z.strictObject({
  size: z.enum(sizes.map((row) => String(row.size))),
  length: z.number().nonnegative(),
  amps: z.number().nonnegative(),
  voltage: z.number().positive(),
  phase: z.enum(["1", "3"]),
});
export const work = z.strictObject({
  version: z.literal(2).default(2),
  inputs: inputs.default(initial),
});
export const workState = {
  route: key,
  title: "Circuit voltage drop",
  description: "Authored copper conductor inputs",
  schema: work,
  schemaVersion: 2,
};
export const result = z.strictObject({
  drop: z.number(),
  percent: z.number(),
  delivered: z.number(),
  area: z.number(),
  multiplier: z.number(),
});
export const value = z.object({ inputs, result: result.nullable() });
export const args = z.object({ target: z.unknown().optional() });
