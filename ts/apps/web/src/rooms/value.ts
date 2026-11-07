import { z } from "zod";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { roomsRouteState, workHandleSchema } from "@pe/agent-contracts";
export const roomsArgs=z.object({view:z.string()});
export const roomsData=z.object({roomsWork:roomsRouteState.schema,handle:workHandleSchema.nullable(),
  snapshot:nativeResponseSchema("rooms.snapshot"),trace:nativeResponseSchema("rooms.trace").nullable(),traceError:z.string().nullable(),plan:z.unknown(),planError:z.string().nullable()});
