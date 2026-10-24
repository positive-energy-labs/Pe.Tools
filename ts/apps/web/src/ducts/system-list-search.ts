import { systemsOf, systemScope } from "@pe/ducts-domain/system-scope";
import { unitFlowsIn } from "@pe/ducts-domain/survey";
import type { survey } from "@pe/ducts-domain/survey";
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import { holding, triage, type TriageInput } from "./inbox-rows";

/** What waits on a system in the inbox: Fix rows holding its ESP (the inbox's rule) and Set rows. */
export interface SystemNote {
  fix: number;
  set: number;
}

/** Same scoped rows as the inbox, per system; unpriced alone is not a defect. */
export function systemNotes(
  surveyed: ReturnType<typeof survey>,
  doc: DuctsRouteDocument | null,
  heal: TriageInput["heal"],
): Map<string, SystemNote> {
  return new Map(
    systemsOf(surveyed.snapshot).map((system) => {
      const scope = systemScope(surveyed.snapshot, system.name);
      const { fix, set } = triage({
        snapshot: surveyed.snapshot,
        scope,
        findings: surveyed.findings,
        flows: surveyed.flows,
        equipmentFlows: unitFlowsIn(surveyed, scope.groups),
        roles: surveyed.roles,
        doc,
        heal,
      });
      return [system.name, { fix: holding(fix), set: set.length }];
    }),
  );
}
