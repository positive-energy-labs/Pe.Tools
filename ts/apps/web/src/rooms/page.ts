import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";
export const roomsPageSchema=routeAddress("rooms").schema.extend({epoch:z.number().default(0)});
export type RoomsPage=z.output<typeof roomsPageSchema>;
