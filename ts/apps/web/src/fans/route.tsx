import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { fansData } from "./neutral";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitFans = async () => {
  const admitted = await loadBuiltinRoute("fans", builtinRouteStamp("fans"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const fansRoute = createRoute({
  getParentRoute: () => root,
  path: "/fans",
  validateSearch: admittedRouteSearch(fansData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitFans} pane="sheet-roster" />
  ),
});
