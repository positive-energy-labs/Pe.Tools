import { createElement, lazy } from "react";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { admittedWork, publicRoutes, typedWorkCells } from "../route/route-discovery";

const HostedAdmittedRoute = lazy(() =>
  import("../workbench/hosted-route").then((module) => ({ default: module.HostedAdmittedRoute })),
);
/** Register one authenticated handle without loading the builtin closure inventory. */
export const registerRoute = (route: AdmittedRoute) =>
  publicRoutes.register({
    manifest: route.data,
    admitted: route,
    work: admittedWork(route),
    hosted: (props) => createElement(HostedAdmittedRoute, { route, ...props }),
  });

const HostedTypedRoute = lazy(() => import("./typed-shell").then(m => ({default:m.HostedTypedRoute})));
/** Same mount/discovery registration for builtin declarations and verified Pod declarations. */
export function registerTypedRoute(typed: import("../route/typed-route").TypedRoute,
  fingerprint: import("@pe/agent-contracts").RouteFingerprint) {
  const key=typed.data.key;
  return publicRoutes.register({manifest:typed.data, typed,
    ...(typed.spec.edits ? {work:{route:key,schema:typed.spec.edits.work.schema,
      ...(typed.spec.edits.key?{memberKey:true as const}:{}),cells:typedWorkCells(typed),workFields:{},
      admission:{routeKey:key,fingerprint}}}:{}),
    hosted:props=>createElement(HostedTypedRoute,{module:typed,fingerprint,...props})});
}
