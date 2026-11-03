import { z } from "zod";
import {
  createBuiltinRouteInventory,
  type AdmittedRoute,
  type BuiltinClosure,
} from "../../../../packages/agent-contracts/src/route-module";
import {
  RouteGraphJson,
  type RouteDiagnostic,
} from "../../../../packages/agent-contracts/src/route-kernel-data";
import { module as captures } from "../captures/kernel";
import { module as schedules } from "../schedules/kernel";
import { module as families } from "../families/kernel";
import { module as ducts } from "../ducts/kernel";
import { module as fans } from "../fans/kernel";
import capturesGenerated from "../captures/source-closure.generated.json";
import schedulesGenerated from "../schedules/source-closure.generated.json";
import familiesGenerated from "../families/source-closure.generated.json";
import ductsGenerated from "../ducts/source-closure.generated.json";
import fansGenerated from "../fans/source-closure.generated.json";

type Generated =
  | typeof capturesGenerated
  | typeof schedulesGenerated
  | typeof familiesGenerated
  | typeof ductsGenerated
  | typeof fansGenerated;
// Generated JSON crosses the admission boundary once; route authors supply no builtin receipt.
const closure = (generated: Generated) => ({
  fingerprint: generated.fingerprint,
  envelope: {
    hostVersion: generated.envelope.hostVersion,
    modules: generated.envelope.modules,
    inputs: generated.envelope.inputs,
    externals: generated.envelope.externals,
    source: z.literal("builtin-closure").parse(generated.envelope.source),
    version: z.literal(1).parse(generated.envelope.version),
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
const definitions = {
  captures: { module: captures, closure: closure(capturesGenerated) },
  schedules: { module: schedules, closure: closure(schedulesGenerated) },
  families: { module: families, closure: closure(familiesGenerated) },
  ducts: { module: ducts, closure: closure(ductsGenerated) },
  fans: { module: fans, closure: closure(fansGenerated) },
};
type BuiltinKey = keyof typeof definitions;
export const builtinRouteKeys = Object.keys(definitions) as BuiltinKey[];
export const builtinRouteStamp = (key: BuiltinKey) => definitions[key].closure.fingerprint;
export async function loadBuiltinRoute(
  key: BuiltinKey,
  expectedFingerprint: string,
): Promise<
  | { readonly ok: true; readonly route: AdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] }
> {
  const owner = key === "fans" ? await loadBuiltinRoute("ducts", builtinRouteStamp("ducts")) : null;
  if (owner && !owner.ok) return owner;
  const definition = definitions[key];
  const inventory = createBuiltinRouteInventory({
    [key]: {
      ...definition,
      ...(owner?.ok && { workOwner: owner.route }),
      catalog: Object.entries(definition.module.entries).map(([entry, contract]) => ({
        key: entry,
        ...contract.axes,
        uses: [],
      })),
    },
  });
  const prepared = await inventory.prepare(key, expectedFingerprint);
  return prepared.admitUnknown(definition.module);
}
