import { commands, refusalText } from "@pe/agent-contracts";

import { command, io, refused, StepFailure } from "./command-executor.ts";
import { Effect } from "effect";
import type { RouteWorkspace } from "@pe/runtime";
import { productRouteWorkPath } from "./product-paths.ts";

export const workStartExecutor=(workspace:RouteWorkspace|undefined)=>command(commands["work.start"],commands["work.start"].input,{
  async bind({admission:{input},work}) {
    if(!workspace) throw refused("Work storage is unavailable");
    workspace.validateSeed(input.key,input.seed);
    if(await work.read(input.key,input.key.route)) throw refused("Work already exists");
    return {effects:[{kind:"directory",path:productRouteWorkPath()}],prepare:async()=>input};
  },
  run({caller,admission},execution) {
    if(!workspace) return Effect.fail(refused("Work storage is unavailable"));
    const {key,seed}=execution.prepared;
    return execution.step("publication","work.start",{key},()=>io(async()=>{
      const result=await workspace.start(key,seed,caller.kind === "pea"?"pea":"human",admission.id);
      if(!result.ok) throw new StepFailure(refusalText(result),409,"refused",result);
      return result;
    }));
  },
});
