import { z } from "zod";
import { effectDecoder } from "@pe/host-contracts/decoders";
import { hostOperationDefinitionSchema } from "@pe/host-contracts/contracts";
import { actionStatusSchema, actionReceiptSchema } from "./action-receipts.ts";
export const opsArgs = z.object({ actionId: z.string() });
export const opsData = z.object({
  catalog: z.object({
    operations: z.array(effectDecoder(hostOperationDefinitionSchema)).optional(),
    bridgeCatalogError: z.string().optional(),
  }),
  receipts: z.array(actionStatusSchema),
  receipt: z.array(actionReceiptSchema),
});
