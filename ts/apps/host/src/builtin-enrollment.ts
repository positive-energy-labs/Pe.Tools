import { familiesHostModule } from "../../web/src/families/neutral.ts";
import familiesGenerated from "../../web/src/families/source-closure.generated.json" with { type: "json" };
import { z } from "zod";
import { schedulesHostModule } from "../../web/src/schedules/neutral.ts";
import schedulesGenerated from "../../web/src/schedules/source-closure.generated.json" with { type: "json" };
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
    routeKey: "families",
    load: async () => familiesHostModule,
    closure: {
      fingerprint: familiesGenerated.fingerprint,
      envelope: {
        ...familiesGenerated.envelope,
        source: "builtin-closure",
        version: 1,
        data: RouteGraphJson.parse(familiesGenerated.envelope.data),
        variants: familiesGenerated.envelope.variants.map((v) => ({
          ...v,
          client: z.enum(["web", "pea"]).parse(v.client),
        })),
      },
    },
  },
  {
    routeKey: "schedules",
    load: async () => schedulesHostModule,
    closure: {
      fingerprint: schedulesGenerated.fingerprint,
      envelope: {
        ...schedulesGenerated.envelope,
        source: "builtin-closure",
        version: 1,
        data: RouteGraphJson.parse(schedulesGenerated.envelope.data),
        variants: schedulesGenerated.envelope.variants.map((v) => ({
          ...v,
          client: z.enum(["web", "pea"]).parse(v.client),
        })),
      },
    },
  },
  {
    routeKey: "captures",
    closure: { envelope, fingerprint: generated.fingerprint },
    load: async () => ({ data: envelope.data, schemas: {}, bodies: {} }),
  },
];
