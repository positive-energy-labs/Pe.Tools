import { z } from "zod";
import { bindWork } from "@pe/agent-contracts/route-state";
import type { ReadContext } from "@pe/host/read-graph";
import { size, type Pipe, type Size } from "./size.ts";
import { args, value, work, key } from "./schema.ts";

const stored = z.object({ doc: work }).nullable();

export const sizing = {
  name: `${key}.sizing`,
  input: args,
  output: value,
  async run(ctx: ReadContext) {
    // Host-wide Work: a Pod has no door to bind Work to the target document (gaps.json).
    const doc = stored.parse(await ctx.work(key, bindWork(key, null)))?.doc ?? work.parse({});
    // Empty until the kernel offers a Pod a piping-system read and a size catalog read (gaps.json).
    const pipes: Pipe[] = [], catalog: Size[] = [];
    const limits = { maxVelocity: doc.maxVelocity, maxFriction: doc.maxFriction };
    return ctx.compute(value, { limits, chosen: doc.chosen }, (inputs) => ({
      limits: inputs.limits,
      ...size(pipes, catalog, inputs.limits, inputs.chosen),
    }));
  },
};
export const reads = { sizing };
