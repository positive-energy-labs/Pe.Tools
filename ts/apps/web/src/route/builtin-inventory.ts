import { module as familiesModule } from "../families/kernel";
import familiesGenerated from "../families/source-closure.generated.json";
import { z } from "zod";
import { createBuiltinRouteInventory } from "../../../../packages/agent-contracts/src/route-module";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { module } from "../captures/kernel";
import { module as schedulesModule } from "../schedules/kernel";
import schedulesGenerated from "../schedules/source-closure.generated.json";
import generated from "../captures/source-closure.generated.json";

// Build/deploy owns this table. Route authors cannot provide a receipt to loadBuiltinRoute.
const closure = {
  fingerprint: generated.fingerprint,
  envelope: {
    ...generated.envelope,
    source: z.literal("builtin-closure").parse(generated.envelope.source),
    version: z.literal(1).parse(generated.envelope.version),
    data: RouteGraphJson.parse(generated.envelope.data),
    variants: generated.envelope.variants.map((variant) => ({
      ...variant,
      client: z.enum(["web", "pea"]).parse(variant.client),
    })),
  },
};
const schedulesClosure = {
  fingerprint: schedulesGenerated.fingerprint,
  envelope: {
    ...schedulesGenerated.envelope,
    source: z.literal("builtin-closure").parse(schedulesGenerated.envelope.source),
    version: z.literal(1).parse(schedulesGenerated.envelope.version),
    data: RouteGraphJson.parse(schedulesGenerated.envelope.data),
    variants: schedulesGenerated.envelope.variants.map((v) => ({
      ...v,
      client: z.enum(["web", "pea"]).parse(v.client),
    })),
  },
};
const familiesClosure = {
  fingerprint: familiesGenerated.fingerprint,
  envelope: {
    ...familiesGenerated.envelope,
    source: z.literal("builtin-closure").parse(familiesGenerated.envelope.source),
    version: z.literal(1).parse(familiesGenerated.envelope.version),
    data: RouteGraphJson.parse(familiesGenerated.envelope.data),
    variants: familiesGenerated.envelope.variants.map((v) => ({
      ...v,
      client: z.enum(["web", "pea"]).parse(v.client),
    })),
  },
};
const definitions = {
  families: {
    module: familiesModule,
    closure: familiesClosure,
    catalog: Object.entries(familiesModule.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    })),
  },
  schedules: {
    module: schedulesModule,
    closure: schedulesClosure,
    catalog: Object.entries(schedulesModule.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    })),
  },
  captures: {
    module,
    closure,
    catalog: Object.entries(module.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    })),
  },
};
const inventory = createBuiltinRouteInventory(definitions);
export const builtinRouteKeys = Object.keys(definitions) as (keyof typeof definitions)[];
export const builtinRouteStamp = (key: "captures" | "schedules" | "families") =>
  key === "families"
    ? familiesClosure.fingerprint
    : key === "schedules"
      ? schedulesClosure.fingerprint
      : closure.fingerprint;
export async function loadBuiltinRoute(
  key: "captures" | "schedules" | "families",
  expectedFingerprint: string,
) {
  const prepared = await inventory.prepare(key, expectedFingerprint);
  return key === "families"
    ? prepared.admitUnknown(familiesModule)
    : key === "schedules"
      ? prepared.admitUnknown(schedulesModule)
      : prepared.admitUnknown(module);
}
