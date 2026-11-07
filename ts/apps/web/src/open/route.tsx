import {createRoute} from "@tanstack/react-router";
import {workFingerprintSchema} from "@pe/agent-contracts";
import {Route as rootRoute} from "../routes/__root";
import {builtinRouteStamp} from "../route/builtin-inventory";
import {TypedShell} from "../shell/typed-shell";
import {module} from "./route";
export const OpenPage=()=> <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("open")}`)}/>;
export const openRoute=createRoute({getParentRoute:()=>rootRoute,path:"/open",validateSearch:(search:Record<string,unknown>)=>search,component:OpenPage});
