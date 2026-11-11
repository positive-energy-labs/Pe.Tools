import { routeRegistry } from "./routes.generated.ts";
import type { BuiltinClosure } from "@pe/agent-contracts";
import type { HostRouteModule } from "@pe/agent-contracts";

export interface BuiltinEnrollment {
  readonly routeKey: string;
  readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
  readonly load: () => Promise<HostRouteModule>;
}
export const builtinEnrollments: readonly BuiltinEnrollment[] = Object.values(routeRegistry).map(
  ({ key, closure, host }) => ({ routeKey: key, closure, load: async () => host }),
);
