import { createFileRoute } from "@tanstack/react-router";
import { TypedShell } from "../shell/typed-shell";
import { module } from "../ducts/route";
import { builtins } from "../route/builtins.neutral";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const Route = createFileRoute("/ducts")({
  validateSearch: (search: Record<string, unknown>) => search as Partial<Record<keyof typeof module.spec.fields | "selected", string>> & {fixture?: string},
  component: () => <TypedShell module={module} fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtins.ducts.closure.fingerprint}`)} />,
});
