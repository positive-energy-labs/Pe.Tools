import type { z } from "zod";
import type { Immutable } from "@pe/agent-contracts/route-kernel-data";
import { product, type FansWorkSchema } from "./product.ts";
export { DUCT_UNIT_ROLES, type DuctFlow } from "@pe/ducts-contract/duct-inputs";

export const fansRouteState = product.work;
export const fansDocumentSchema: FansWorkSchema = fansRouteState.schema;
export type FansRouteDocument = z.output<FansWorkSchema>;
export type FansDocument = Immutable<Omit<FansRouteDocument, "writeIntent">>;
export type DuctUnitRole = NonNullable<FansRouteDocument["roles"][string]["edit"]>["value"];
export const neutralFansWork = fansDocumentSchema.parse({});
