import {routeFile} from "../route/address-page";
import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../open/route";
export const Route = createFileRoute("/open")({
  validateSearch: routeFile("open").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("open")}`)}
    />
  ),
});
