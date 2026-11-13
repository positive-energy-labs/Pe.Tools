import { body } from "@pe/host/read-graph";
import { calculation as declaration } from "./contract.ts";
import { bindWork } from "@pe/agent-contracts/route-state";
import type { ReadContext } from "@pe/host/read-graph";
import { calculate } from "../../pages/tour/calc.mjs";
import { value, work, key } from "./schema.ts";
export const calculation = body(declaration, async function(ctx: ReadContext) {
    const observed = await ctx.work(key, bindWork(key, null));
    const current = work.parse(
      observed && typeof observed === "object" && "doc" in observed ? observed.doc : {},
    );
    return ctx.compute(value, { inputs: current.inputs }, ({ inputs }) => ({
      inputs,
      result: calculate(inputs),
    }));
  });
export const reads = { calculation };
