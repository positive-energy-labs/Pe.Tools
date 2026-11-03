import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { schedulesData } from "./neutral";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitSchedules = async () => {
  const admitted = await loadBuiltinRoute("schedules", builtinRouteStamp("schedules"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const schedulesRoute = createRoute({
  getParentRoute: () => root,
  path: "/schedules",
  validateSearch: admittedRouteSearch(schedulesData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitSchedules} />
  ),
});
