import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { isReadEffect } from "@pe/host-contracts/contracts";
export type HostOperationCatalogEntry = HostOperationDefinition & {
  requestSchemaJson?: string;
  responseSchemaJson?: string;
};
export const isMutation = (op?: HostOperationCatalogEntry) =>
  !!op && !isReadEffect(op.effect);
