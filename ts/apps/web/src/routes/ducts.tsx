import { createFileRoute } from "@tanstack/react-router";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { ductsData } from "../ducts/route";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitDucts = async () => {
  const admitted = await loadBuiltinRoute("ducts", builtinRouteStamp("ducts"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const Route = createFileRoute("/ducts")({
  validateSearch: admittedRouteSearch(ductsData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitDucts} />
  ),
});
