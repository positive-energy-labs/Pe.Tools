import {routeFile} from "../route/address-page";
import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../rooms/route";
export const Route = createFileRoute("/rooms")({
  validateSearch: routeFile("rooms").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("rooms")}`)}
    />
  ),
});
