import { read } from "@pe/host/read-graph";
import { capturesArgs, capturesValue } from "@pe/agent-contracts";
import { captures } from "../builtin-read-handles.ts";
export const reads = {browse:read("captures.browse",{
  input:capturesArgs,output:capturesValue,
  run:(ctx)=>ctx.read(captures,{kind:"captures"}),
})};
