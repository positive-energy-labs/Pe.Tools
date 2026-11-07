import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { TypedShell } from "../shell/typed-shell";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "../design-system/route";
export const Route = createFileRoute("/design-system")({
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(
        `builtin-closure:${builtinRouteStamp("design-system")}`,
      )}
    />
  ),
});
