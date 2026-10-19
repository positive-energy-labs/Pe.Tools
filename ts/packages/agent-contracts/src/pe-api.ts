import { definePeApi } from "@pe/host-contracts/pe-api";
import * as schemas from "./index.ts";

export const {
  peRoutes,
  isPeRouteId,
  peRouteUrl,
  matchPeRoute,
  servePeRoute,
  createPeClient,
  peClientScript,
} = definePeApi({
  ...schemas,
  actionControlInputSchema: schemas.actionControls["action.cancel"].input,
  diagnosticBodySchema: schemas.receiptBodySchema.options.find(
    (s) => s.shape.kind.value === "diagnostic",
  )!,
});
export type PeRouteId = keyof typeof peRoutes;
