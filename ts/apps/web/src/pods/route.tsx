import { createRoute } from "@tanstack/react-router";
import { Route as root } from "../routes/__root";
import { TypedShell } from "../shell/typed-shell";
import { module } from "./route.ts";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const podsRoute = createRoute({
  getParentRoute: () => root,
  path: "/pods",
  validateSearch: (search: Record<string, unknown>) => search,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("pods")}`)}
    />
  ),
});
