import { z } from "zod";
export const ductLossArgs = z.object({
  shape: z.enum(["round", "rect"]),
  a: z.number(),
  b: z.number(),
  cfm: z.number(),
  length: z.number(),
  roughness: z.number(),
  density: z.number(),
});
export const ductLossData = z.object({
  error: z.string().nullable(),
  result: z
    .object({
      area: z.number(),
      velocity: z.number(),
      hydraulicDiameter: z.number(),
      equivalentDiameter: z.number(),
      reynolds: z.number(),
      friction: z.number(),
      lossPer100: z.number(),
      loss: z.number(),
    })
    .nullable(),
});

/** Galvanized steel absolute roughness in feet. */
export const GALVANIZED_STEEL_ROUGHNESS = 0.0003;

import { executionTargetSchema } from "@pe/agent-contracts";
import { contract } from "@pe/agent-contracts/handle";

/** The one declaration of each read this route serves: the pane and the host body both take it from here. */
export const result = contract("duct-loss.result", {
  input: ductLossArgs.extend({ target: executionTargetSchema }),
  data: ductLossData,
  uses: [],
  // A calculator: it reads its own arguments and no model.
  subject: "None",
});
