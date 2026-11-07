import {bindWork} from "../../../../../ts/packages/agent-contracts/src/route-state.ts";
import type {ReadContext} from "../../../../../ts/apps/host/src/reads/evaluator.ts";
import {calculate} from "../../pages/tour/calc.mjs";
import {args,value,work,key} from "./schema.ts";
export const calculation={name:`${key}.calculation`,input:args,output:value,
  async run(ctx:ReadContext) {
    const observed=await ctx.work(key,bindWork(key,null));
    const current=work.parse(observed&&typeof observed === "object"&&"doc" in observed?observed.doc:{});
    return ctx.compute(value,{inputs:current.inputs},({inputs})=>({inputs,result:calculate(inputs)}));
  }};
export const reads={calculation};
