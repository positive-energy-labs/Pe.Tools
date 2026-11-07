import {createRoute} from "@tanstack/react-router";
import {workFingerprintSchema} from "@pe/agent-contracts";
import {Route as rootRoute} from "../routes/__root";
import {builtinRouteStamp} from "../route/builtin-inventory";
import {TypedShell} from "../shell/typed-shell";
import {module} from "./route";
export const opsRoute=createRoute({getParentRoute:()=>rootRoute,path:"/ops",validateSearch:(search:Record<string,unknown>)=>search,component:()=> <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("ops")}`)}/>});
