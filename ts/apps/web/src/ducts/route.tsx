import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { ductsData } from "./neutral";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitDucts = async () => {
  const admitted = await loadBuiltinRoute("ducts", builtinRouteStamp("ducts"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const ductsRoute = createRoute({
  getParentRoute: () => root,
  path: "/ducts",
  validateSearch: admittedRouteSearch(ductsData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitDucts} pane="e-systems" />
  ),
});
