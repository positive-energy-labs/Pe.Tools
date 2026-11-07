// Generated from route.ts by codegen:routes. Host only.
import {host as neutral} from "./neutral.generated.ts";
import * as runtime from "../../../host/src/reads/captures.ts";
import type {HostRouteModule} from "@pe/agent-contracts";
export const host:HostRouteModule={...neutral,reads:(runtime as Pick<HostRouteModule,"reads">).reads,};
