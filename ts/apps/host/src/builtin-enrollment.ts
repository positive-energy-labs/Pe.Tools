import { builtins } from "./reads/builtins.generated.ts";
import type { BuiltinClosure } from "@pe/agent-contracts";
import type { HostRouteModule } from "@pe/agent-contracts";

export interface BuiltinEnrollment {
  readonly routeKey: string;
  readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
  readonly load: () => Promise<HostRouteModule>;
}
export const builtinEnrollments: readonly BuiltinEnrollment[] = Object.entries(builtins).map(
  ([routeKey, { closure, host }]) => ({ routeKey, closure, load: async () => host }),
);
