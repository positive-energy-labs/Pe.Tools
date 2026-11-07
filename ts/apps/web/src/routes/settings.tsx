import {routeFile} from "../shell/route-file";
import { createFileRoute } from "@tanstack/react-router";
import { TypedShell } from "../shell/typed-shell";
import { module } from "../settings/route.ts";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const Route = createFileRoute("/settings")({
  validateSearch: routeFile("settings").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("settings")}`)}
    />
  ),
});
