import { commands, refusalText } from "@pe/agent-contracts";

import { command, refused } from "./command-executor.ts";
import type { RouteWorkspace } from "@pe/runtime";
import { productRouteWorkPath } from "./product-paths.ts";

export const workStartExecutor=(workspace:RouteWorkspace|undefined)=>command(commands["work.start"],commands["work.start"].input,{
  async bind({admission:{input}}) {
    if(!workspace) throw refused("Work storage is unavailable");
    workspace.validateSeed(input.key,input.seed);
    if(await workspace.readRaw(input.key,input.key.route)) throw refused("Work already exists");
    return {effects:[{kind:"directory",path:productRouteWorkPath()}],prepare:async()=>input};
  },
  async run({caller,admission},execution) {
    if(!workspace) throw refused("Work storage is unavailable");
    const {key,seed}=execution.prepared;
    return execution.step("publication","work.start",{key},async()=>{
      const result=await workspace.start(key,seed,caller.kind === "pea"?"pea":"human",admission.id);
      if(!result.ok) throw refused(refusalText(result));
      return result;
    });
  },
});
