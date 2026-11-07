import {
  createBuiltinRouteInventory,
  type AdmittedRoute,
} from "../../../../packages/agent-contracts/src/route-module";
import type { RouteDiagnostic } from "../../../../packages/agent-contracts/src/route-kernel-data";
import {builtinClosures} from "./builtin-closures.generated";
import {closureSchema} from "./builtin-closure";
import {builtinModules} from "./builtin-modules.generated";
import type {TypedRoute} from "./typed-route";
export type BuiltinKey=keyof typeof builtinModules;
export const typedBuiltin = (key:BuiltinKey):TypedRoute | null => {
  const module=builtinModules[key]; return "spec" in module ? module as TypedRoute : null;
};

type Admitted =
  | { readonly ok: true; readonly route: AdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export const builtinRouteKeys = Object.keys(builtinModules) as BuiltinKey[];
export const builtinRouteStamp = (key: BuiltinKey) => builtinClosures[key].fingerprint;
// One admission per (key, stamp).
const admissions = new Map<string, Promise<Admitted>>();
export function loadBuiltinRoute(key: BuiltinKey, expectedFingerprint: string) {
  const id = `${key}\n${expectedFingerprint}`;
  const pending = admissions.get(id) ?? admit(key, expectedFingerprint);
  admissions.set(id, pending);
  return pending;
}
async function admit(key: BuiltinKey, expectedFingerprint: string): Promise<Admitted> {
  const closure=closureSchema.parse(builtinClosures[key]);
  if (typedBuiltin(key)) throw Error("Typed routes mount directly");
  const module = builtinModules[key];
  const inventory = createBuiltinRouteInventory({
    [key]: {
      module,
      closure,
      catalog: Object.entries(module.entries).map(([entry, contract]) => ({
        key: entry,
        ...contract.axes,
        uses: [],
      })),
    },
  });
  const prepared = await inventory.prepare(key, expectedFingerprint);
  return prepared.admitUnknown(module);
}
