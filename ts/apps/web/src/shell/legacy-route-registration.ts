import { createElement, lazy } from "react";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { admittedWork, publicRoutes } from "./legacy-discovery";
const HostedAdmittedRoute = lazy(() =>
  import("../workbench/legacy-hosted-route").then((module) => ({ default: module.HostedAdmittedRoute })),
);
/** Register one authenticated handle without loading the builtin closure inventory. */
export const registerRoute = (route: AdmittedRoute) =>
  publicRoutes.register({
    manifest: route.data,
    admitted: route,
    work: admittedWork(route),
    hosted: (props) => createElement(HostedAdmittedRoute, { route, ...props }),
  });
