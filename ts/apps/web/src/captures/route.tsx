import {routeFile} from "../route";
import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { TypedShell } from "../shell/typed-shell";
import { module } from "./route.ts";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const capturesRoute = createRoute({
  getParentRoute: () => root,
  path: "/captures",
  validateSearch: routeFile("captures").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("captures")}`)}
    />
  ),
});
