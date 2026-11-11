import { createFileRoute } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { routeFile } from "../shell/route-file";
import { TypedShell } from "../shell/typed-shell";
import { routeAt } from "../route/registry";

const home = routeAt("/")!;
export const Route = createFileRoute("/")({
  ...routeFile("home"),
  component: () => (
    <TypedShell
      module={home.module}
      fingerprint={workFingerprintSchema.parse(`builtin-closure:${home.closure.fingerprint}`)}
    />
  ),
});
