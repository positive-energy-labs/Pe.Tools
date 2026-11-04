/** Builtin closure pins and DOM-free host modules share one manifest. */
import { z } from "zod";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { BuiltinClosure } from "../../../../packages/agent-contracts/src/route-module.ts";
import type { HostRouteModule } from "../../../../packages/agent-contracts/src/host-route-admission.ts";
import { ductsHostModule } from "../ducts/neutral.ts";
import { fansHostModule } from "../fans/neutral.ts";
import { familiesHostModule } from "../families/neutral.ts";
import { schedulesHostModule } from "../schedules/neutral.ts";
import capturesGenerated from "../captures/source-closure.generated.json" with { type: "json" };
import schedulesGenerated from "../schedules/source-closure.generated.json" with { type: "json" };
import familiesGenerated from "../families/source-closure.generated.json" with { type: "json" };
import ductsGenerated from "../ducts/source-closure.generated.json" with { type: "json" };
import fansGenerated from "../fans/source-closure.generated.json" with { type: "json" };

const member = z.strictObject({ id: z.string(), sha256: z.string() });
const closureSchema: z.ZodType<{ fingerprint: string; envelope: BuiltinClosure }> =
  z.strictObject({
    fingerprint: z.string(),
    envelope: z.strictObject({
      source: z.literal("builtin-closure"),
      version: z.literal(1),
      data: RouteGraphJson,
      variants: z.array(z.strictObject({ client: z.enum(["web", "pea"]), entry: z.string() })),
      modules: z.array(member),
      inputs: z.array(member),
      externals: z.array(member),
    }),
  });

const captures = closureSchema.parse(capturesGenerated);
interface Builtin { closure: z.output<typeof closureSchema>; host: HostRouteModule }
export const builtins: Record<"captures" | "schedules" | "families" | "ducts" | "fans", Builtin> = {
  captures: { closure: captures, host: { data: captures.envelope.data, schemas: {}, bodies: {} } },
  schedules: { closure: closureSchema.parse(schedulesGenerated), host: schedulesHostModule },
  families: { closure: closureSchema.parse(familiesGenerated), host: familiesHostModule },
  ducts: { closure: closureSchema.parse(ductsGenerated), host: ductsHostModule },
  fans: { closure: closureSchema.parse(fansGenerated), host: fansHostModule },
};
export type BuiltinKey = keyof typeof builtins;
export const isBuiltinKey = (key: string): key is BuiltinKey => Object.hasOwn(builtins, key);
