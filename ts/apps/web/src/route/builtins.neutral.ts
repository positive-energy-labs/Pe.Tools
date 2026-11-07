/// <reference path="./source-closure.d.ts" />
import type {HostRouteModule} from "@pe/agent-contracts";
import {closureSchema} from "./builtin-closure.ts";
import {typedBuiltins} from "./builtin-typed.generated.ts";
type Builtin={host:HostRouteModule;closure:ReturnType<typeof closureSchema.parse>};
export const builtins=Object.fromEntries(Object.entries(typedBuiltins).map(([key,value])=>[key,{host:value.host,closure:closureSchema.parse(value.closure)}])) as {[K in keyof typeof typedBuiltins]:Builtin};
export type BuiltinKey=keyof typeof builtins;
export const isBuiltinKey=(key:string):key is BuiltinKey=>Object.hasOwn(builtins,key);
