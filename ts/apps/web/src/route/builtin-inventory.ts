import { z } from "zod";
import { createBuiltinRouteInventory } from "../../../../packages/agent-contracts/src/route-module";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { module } from "../captures/kernel";
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
const inventory = createBuiltinRouteInventory({
  captures: {
    module,
    closure,
    catalog: Object.entries(module.entries).map(([key, entry]) => ({
      key,
      ...entry.axes,
      uses: [],
    })),
  },
});
export const builtinRouteStamp = (_key: "captures") => closure.fingerprint;
export async function loadBuiltinRoute(key: "captures", expectedFingerprint: string) {
  return (await inventory.prepare(key, expectedFingerprint)).admit(module);
}
