import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { podsData } from "./neutral";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
export async function admitPods() {
  const result = await loadBuiltinRoute("pods", builtinRouteStamp("pods"));
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}
export const podsRoute = createRoute({
  getParentRoute: () => root,
  path: "/pods",
  validateSearch: (
    search: Record<string, unknown>,
  ): Partial<
    Record<"pod" | "path" | "runs" | "threadSearch" | "threadSort" | "fixture", unknown>
  > => admittedRouteSearch(podsData)(search),
  component: () => <AdmittedRouteView shell={applicationRouteShell} load={admitPods} />,
});
