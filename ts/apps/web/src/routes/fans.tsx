import { createFileRoute } from "@tanstack/react-router";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { fansData } from "../fans/route";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export const admitFans = async () => {
  const admitted = await loadBuiltinRoute("fans", builtinRouteStamp("fans"));
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
};
export const Route = createFileRoute("/fans")({
  validateSearch: admittedRouteSearch(fansData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitFans} />
  ),
});
