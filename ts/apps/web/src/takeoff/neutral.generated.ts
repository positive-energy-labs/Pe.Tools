// Generated from route.ts by codegen:routes. Neutral projection only.
import { takeoffsRouteState as work } from "../../../../packages/agent-contracts/src/generated/takeoffs-work.ts";
import {z} from "zod";
import {RouteGraphJson} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {HostRouteModule} from "@pe/agent-contracts";
import closure from "./source-closure.generated.json" with {type:"json"};
const data=RouteGraphJson.parse(closure.envelope.data);
export const host:HostRouteModule={data,workState:work,readWorks:[],schemas:{[data.work!.schema!]:work.schema,[data.historyDetail!]:z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{}})},};
