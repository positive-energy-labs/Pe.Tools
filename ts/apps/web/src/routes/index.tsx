import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../home/route";
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => search,
  component: () => <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("home")}`)} />,
});
