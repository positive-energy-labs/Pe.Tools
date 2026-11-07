import {z} from "zod";
import {effectDecoder} from "@pe/host-contracts/decoders";
import {bridgeSessionsListSchema} from "@pe/host-contracts/operation-types";
import {harnessThreadSummarySchema} from "@pe/agent-contracts";
export const bindData=z.object({threads:z.array(harnessThreadSummarySchema),inventory:effectDecoder(bridgeSessionsListSchema)});
