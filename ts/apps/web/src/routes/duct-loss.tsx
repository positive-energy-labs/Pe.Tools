import {routeFile} from "../route/address-page";
import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../duct-loss/route";
export const Route = createFileRoute("/duct-loss")({
  validateSearch: routeFile("duct-loss").validateSearch,
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("duct-loss")}`)}
    />
  ),
});
