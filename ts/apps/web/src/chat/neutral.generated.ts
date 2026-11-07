// Generated from route.ts by codegen:routes. Neutral projection only.
import {RouteGraphJson} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {HostRouteModule} from "@pe/agent-contracts";
import closure from "./source-closure.generated.json" with {type:"json"};
const data=RouteGraphJson.parse(closure.envelope.data);
export const host:HostRouteModule={data,bodies:{},schemas:{},};
