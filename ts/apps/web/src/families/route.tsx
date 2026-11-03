import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { familiesData } from "./neutral";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitFamilies = async () => {
  const admitted = await loadBuiltinRoute("families", builtinRouteStamp("families"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const familiesRoute = createRoute({
  getParentRoute: () => root,
  path: "/families",
  validateSearch: admittedRouteSearch(familiesData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitFamilies} />
  ),
});
