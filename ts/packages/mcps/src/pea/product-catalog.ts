import { createPeCatalog, type httpRoutes, type PeCatalog } from "@pe/agent-contracts/pe-api";
import { ductCatalogRouteAxes, ductCatalogRoutes } from "@pe/ducts-contract/duct-catalog";
import { ductsReadingCallPolicies } from "@pe/ducts-contract/reading";
import { fansReadDiscovery } from "@pe/fans-contract/read-discovery";
import { hostActions } from "./product-actions.ts";

type ProductCatalog = PeCatalog<typeof httpRoutes & typeof ductCatalogRoutes>;
const catalog: ProductCatalog = createPeCatalog(hostActions, fansReadDiscovery, {
  routes: ductCatalogRoutes,
  axes: ductCatalogRouteAxes,
  resourceReads: Object.keys(ductsReadingCallPolicies),
  callPolicies: ductsReadingCallPolicies,
});
export const peRoutes: ProductCatalog["peRoutes"] = catalog.peRoutes;
export const linkedCatalog: ProductCatalog["linkedCatalog"] = catalog.linkedCatalog;
export const matchPeRoute: ProductCatalog["matchPeRoute"] = catalog.matchPeRoute;
export const servePeRoute: ProductCatalog["servePeRoute"] = catalog.servePeRoute;
export const peClientScript: ProductCatalog["peClientScript"] = catalog.peClientScript;
export const isPeRouteId: ProductCatalog["isPeRouteId"] = catalog.isPeRouteId;
export const createPeClient: ProductCatalog["createPeClient"] = catalog.createPeClient;
