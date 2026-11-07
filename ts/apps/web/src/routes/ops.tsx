import {routeFile} from "../shell/route-file";
import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../ops/route";
export const Route = createFileRoute("/ops")({
  validateSearch: routeFile("ops").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("ops")}`)}
    />
  ),
});
