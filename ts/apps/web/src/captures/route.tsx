import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { AdmittedRouteView, admittedRouteSearch } from "../shell/admitted-pane";
import { applicationRouteShell } from "../shell/application-route-shell";
import { capturesData } from "./kernel";
import { admitCaptures } from "./admission";

export const capturesRoute = createRoute({
  getParentRoute: () => root,
  path: "/captures",
  validateSearch: admittedRouteSearch(capturesData),
  component: () => (
    <AdmittedRouteView shell={applicationRouteShell} load={admitCaptures} />
  ),
});
