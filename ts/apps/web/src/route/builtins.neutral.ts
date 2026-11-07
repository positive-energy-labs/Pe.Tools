/// <reference path="./source-closure.d.ts" />
/** Builtin closures and DOM-free host modules share one manifest. Closures are untracked output of
 * scripts/route-graphs.ts: bundles get them from routeModuleHash, jiti host dev from dev-watch. */
import { z } from "zod";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { BuiltinClosure } from "../../../../packages/agent-contracts/src/route-module.ts";
import type { HostRouteModule } from "../../../../packages/agent-contracts/src/host-route-admission.ts";
import { familiesHostModule } from "../families/neutral.ts";
import { podsHostModule } from "../pods/neutral.ts";
import podsGenerated from "../pods/source-closure.generated.json" with { type: "json" };
import { schedulesHostModule } from "../schedules/neutral.ts";
import capturesGenerated from "../captures/source-closure.generated.json" with { type: "json" };
import schedulesGenerated from "../schedules/source-closure.generated.json" with { type: "json" };
import familiesGenerated from "../families/source-closure.generated.json" with { type: "json" };
import chatGenerated from "../chat/source-closure.generated.json" with { type: "json" };
import { module as chat } from "../chat/kernel.ts";

const member = z.strictObject({ id: z.string(), sha256: z.string() });
const closureSchema: z.ZodType<{ fingerprint: string; envelope: BuiltinClosure }> = z.strictObject({
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

import {typedBuiltins} from "./builtin-typed.generated.ts";
const captures = closureSchema.parse(capturesGenerated);
interface Builtin {
  closure: z.output<typeof closureSchema>;
  host: HostRouteModule;
}
export const builtins = {
  pods: { closure: closureSchema.parse(podsGenerated), host: podsHostModule },
  captures: { closure: captures, host: { data: captures.envelope.data, schemas: {}, bodies: {} } },
  schedules: { closure: closureSchema.parse(schedulesGenerated), host: schedulesHostModule },
  families: { closure: closureSchema.parse(familiesGenerated), host: familiesHostModule },
  chat: {
    closure: closureSchema.parse(chatGenerated),
    host: { data: chat.data, schemas: chat.schemas, bodies: {} },
  },
  ...Object.fromEntries(Object.entries(typedBuiltins).map(([key,value])=>[key,{host:value.host,closure:closureSchema.parse(value.closure)}])) as {[K in keyof typeof typedBuiltins]:Builtin},
};
export type BuiltinKey = keyof typeof builtins;
export const isBuiltinKey = (key: string): key is BuiltinKey => Object.hasOwn(builtins, key);
