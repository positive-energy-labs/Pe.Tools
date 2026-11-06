import {
  createBuiltinRouteInventory,
  type AdmittedRoute,
} from "../../../../packages/agent-contracts/src/route-module";
import type { RouteDiagnostic } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { module as captures } from "../captures/kernel";
import { module as schedules } from "../schedules/kernel";
import { module as families } from "../families/kernel";
import { module as ducts } from "../ducts/kernel";
import { module as fans } from "../fans/kernel";
import { module as chat } from "../chat/kernel";
import { builtins, type BuiltinKey } from "./builtins.neutral";

const modules = { captures, schedules, families, ducts, fans, chat } satisfies Record<
  BuiltinKey,
  unknown
>;
type Admitted =
  | { readonly ok: true; readonly route: AdmittedRoute }
  | { readonly ok: false; readonly diagnostics: readonly RouteDiagnostic[] };
export const builtinRouteKeys = Object.keys(builtins) as BuiltinKey[];
export const builtinRouteStamp = (key: BuiltinKey) => builtins[key].closure.fingerprint;
// One admission per (key, stamp).
const admissions = new Map<string, Promise<Admitted>>();
export function loadBuiltinRoute(key: BuiltinKey, expectedFingerprint: string) {
  const id = `${key}\n${expectedFingerprint}`;
  const pending = admissions.get(id) ?? admit(key, expectedFingerprint);
  admissions.set(id, pending);
  return pending;
}
async function admit(key: BuiltinKey, expectedFingerprint: string): Promise<Admitted> {
  const { closure } = builtins[key];
  const module = modules[key];
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
