import { createFileRoute } from "@tanstack/react-router";
import { TypedShell } from "../shell/typed-shell";
import { module } from "../families/route";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const Route = createFileRoute("/families")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Partial<Record<keyof typeof module.spec.fields | "selected", string>> & {
      fixture?: string;
    },
  component: () => (
    <TypedShell
      module={module}
      fingerprint={workFingerprintSchema.parse(
        `builtin-closure:${builtinRouteStamp("families")}`,
      )}
    />
  ),
});
