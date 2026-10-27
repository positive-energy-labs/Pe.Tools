import {
  definePeApi,
  type PeApi,
  type PeApiSchemas,
  type PeRouteTable,
} from "@pe/host-contracts/pe-api";
import * as schemas from "./index.ts";

type RouteSchemas = Pick<
  typeof schemas,
  Exclude<keyof PeApiSchemas, "actionControlInputSchema" | "diagnosticBodySchema">
> & {
  actionControlInputSchema: (typeof schemas.actionControls)["action.cancel"]["input"];
  diagnosticBodySchema: (typeof schemas.receiptBodySchema.options)[number];
};
const routeSchemas: RouteSchemas = {
  ...schemas,
  actionControlInputSchema: schemas.actionControls["action.cancel"].input,
  diagnosticBodySchema: schemas.receiptBodySchema.options.find(
    (s) => s.shape.kind.value === "diagnostic",
  )!,
};
type Routes = PeRouteTable<typeof routeSchemas>;
const api: PeApi<Routes> = definePeApi(routeSchemas);
export const peRoutes: Routes = api.peRoutes;
export const isPeRouteId: PeApi<Routes>["isPeRouteId"] = api.isPeRouteId;
export const peRouteUrl: PeApi<Routes>["peRouteUrl"] = api.peRouteUrl;
export const matchPeRoute: PeApi<Routes>["matchPeRoute"] = api.matchPeRoute;
export const servePeRoute: PeApi<Routes>["servePeRoute"] = api.servePeRoute;
export const createPeClient: PeApi<Routes>["createPeClient"] = api.createPeClient;
export const peClientScript: PeApi<Routes>["peClientScript"] = api.peClientScript;
export type PeRouteId = keyof typeof peRoutes;
