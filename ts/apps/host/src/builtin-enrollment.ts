import { builtins } from "../../web/src/route/builtins.neutral.ts";
import type { BuiltinClosure } from "../../../packages/agent-contracts/src/route-module.ts";
import type { HostRouteModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";

export interface BuiltinEnrollment {
  readonly routeKey: string;
  readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
  readonly load: () => Promise<HostRouteModule>;
}
export const builtinEnrollments: readonly BuiltinEnrollment[] = Object.entries(builtins).map(
  ([routeKey, { closure, host }]) => ({ routeKey, closure, load: async () => host }),
);
