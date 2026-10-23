import { systemsOf, systemScope } from "@pe/ducts-domain/system-scope";
import { unitFlowsIn } from "@pe/ducts-domain/survey";
import type { survey } from "@pe/ducts-domain/survey";
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import { holding, triage, type TriageInput } from "./inbox-rows";

/** Same scoped Fix rows and holding rule as the inbox; unpriced alone is not a defect. */
export function systemsNeedingFix(
  surveyed: ReturnType<typeof survey>,
  doc: DuctsRouteDocument | null,
  heal: TriageInput["heal"],
) {
  return new Set(
    systemsOf(surveyed.snapshot)
      .filter((system) => {
        const scope = systemScope(surveyed.snapshot, system.name);
        return (
          holding(
            triage({
              snapshot: surveyed.snapshot,
              scope,
              findings: surveyed.findings,
              flows: surveyed.flows,
              equipmentFlows: unitFlowsIn(surveyed, scope.groups),
              roles: surveyed.roles,
              doc,
              heal,
            }).fix,
          ) > 0
        );
      })
      .map((system) => system.name),
  );
}
