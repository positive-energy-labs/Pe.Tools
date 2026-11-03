import { z } from "zod";
import generated from "../../web/src/captures/source-closure.generated.json" with { type: "json" };
import { RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { BuiltinClosure } from "../../../packages/agent-contracts/src/route-module.ts";
import type { HostRouteModule } from "../../../packages/agent-contracts/src/host-route-admission.ts";

export interface BuiltinEnrollment {
  readonly routeKey: string;
  readonly closure: { readonly envelope: BuiltinClosure; readonly fingerprint: string };
  readonly load: () => Promise<HostRouteModule>;
}
const envelope: BuiltinClosure = {
  ...generated.envelope,
  source: "builtin-closure",
  version: 1,
  data: RouteGraphJson.parse(generated.envelope.data),
  variants: generated.envelope.variants.map((v) => ({
    ...v,
    client: z.enum(["web", "pea"]).parse(v.client),
  })),
};
/** Captures is registry-only. Its generated declaration imports no UI or browser code. */
export const builtinEnrollments: readonly BuiltinEnrollment[] = [
  {
    routeKey: "captures",
    closure: { envelope, fingerprint: generated.fingerprint },
    load: async () => ({ data: envelope.data, schemas: {}, bodies: {} }),
  },
];
