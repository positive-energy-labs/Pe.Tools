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
    // mep.system.members and mep.segment.sizes exist; a Pod has no door to call them yet
    // (gaps.json: pod-native-read-door). With it: fromRevit(members, sizes) fills these.
    const pipes: Pipe[] = [], catalogs: Record<string, Size[]> = {};
    const limits = { maxVelocity: doc.maxVelocity, maxFriction: doc.maxFriction };
    return ctx.compute(value, { limits, chosen: doc.chosen }, (inputs) => ({
      limits: inputs.limits,
      ...size(pipes, catalogs, inputs.limits, inputs.chosen),
    }));
  },
};
export const reads = { sizing };
