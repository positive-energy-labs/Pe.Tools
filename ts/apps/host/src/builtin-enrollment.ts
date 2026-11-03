import { ductsHostModule } from "../../web/src/ducts/neutral.ts";
import { fansHostModule } from "../../web/src/fans/neutral.ts";
import ductsGenerated from "../../web/src/ducts/source-closure.generated.json" with { type: "json" };
import fansGenerated from "../../web/src/fans/source-closure.generated.json" with { type: "json" };
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
type Generated =
  | typeof generated
  | typeof schedulesGenerated
  | typeof familiesGenerated
  | typeof ductsGenerated
  | typeof fansGenerated;
const closure = (generated: Generated): BuiltinEnrollment["closure"] => ({
  fingerprint: generated.fingerprint,
  envelope: {
    hostVersion: generated.envelope.hostVersion,
    modules: generated.envelope.modules,
    inputs: generated.envelope.inputs,
    externals: generated.envelope.externals,
    source: "builtin-closure",
    version: 1,
    data: RouteGraphJson.parse(generated.envelope.data),
    ...("workOwner" in generated.envelope && {
      workOwner: generated.envelope.workOwner as BuiltinClosure["workOwner"],
    }),
    variants: generated.envelope.variants.map((variant) => ({
      ...variant,
      client: z.enum(["web", "pea"]).parse(variant.client),
    })),
  },
});
/** Owner enrollment precedes every presenter; a presenter creates no second Work registration. */
export const builtinEnrollments: readonly BuiltinEnrollment[] = [
  {
    routeKey: "families",
    load: async () => familiesHostModule,
    closure: closure(familiesGenerated),
  },
  {
    routeKey: "schedules",
    load: async () => schedulesHostModule,
    closure: closure(schedulesGenerated),
  },
  {
    routeKey: "captures",
    load: async () => ({ data: closure(generated).envelope.data, schemas: {}, bodies: {} }),
    closure: closure(generated),
  },
  { routeKey: "ducts", load: async () => ductsHostModule, closure: closure(ductsGenerated) },
  { routeKey: "fans", load: async () => fansHostModule, closure: closure(fansGenerated) },
];
