import { createFileRoute } from "@tanstack/react-router";
import { TypedShell } from "../shell/typed-shell";
import { module } from "../fans/route";
import { builtins } from "../route/builtins.neutral";
import { workFingerprintSchema } from "@pe/agent-contracts";
export const Route = createFileRoute("/fans")({
  validateSearch: (search: Record<string, unknown>): { fixture?: unknown } => search,
  component: () => <TypedShell module={module} fingerprint={workFingerprintSchema.parse(builtins.fans.closure.fingerprint)} />,
});
