import { DUCTS_DEFAULT_CRITERIA, type DuctsFirm } from "@pe/ducts-contract/duct-inputs";
import { stagedDucts, type DuctsDesign, type StagedCell } from "@pe/duct-systems-contract/ducts";
import type { WorkLayer } from "./calc/inputs.ts";
// The engine default: what a criterion runs on when no home tier states it. Velocity limits are
// Manual D's rules of thumb (trunk 900 supply, 700 return); 0.03 in-wg is the grille placeholder;
// 3 in and 36 in are the Q5 auto-join gap and the Q6 heal box. The firm's own numbers belong in the file.
export const FIRM_SEED: DuctsFirm = {
  version: "seed",
  criteria: DUCTS_DEFAULT_CRITERIA,
};

/** Work's staged cells as the resolver reads them: each keeps its caller and ref, with the value unwrapped to what is priced. */
export function workLayer(design: DuctsDesign): WorkLayer {
  const staged = stagedDucts(design, design);
  // An unreadable cell's marker passes through untouched, so the resolver holds its row invalid.
  const cells = <V, T>(segment: Record<string, StagedCell<V>>, value: (v: V) => T) =>
    Object.fromEntries(
      Object.entries(segment).map(([key, cell]) => [
        key,
        "invalid" in cell ? cell : { ...cell, value: value(cell.value) },
      ]),
    );
  return {
    flows: staged.flows,
    terminalDrops: cells(staged.terminalDrops, (v) => v.inWg),
    componentDrops: cells(staged.componentDrops, (v) => v.inWg),
    ratedEsp: cells(staged.ratedEsp, (v) => v.inWg),
    equipmentFlows: staged.equipmentFlows,
    roles: cells(staged.roles, (v) => v.role),
    kinds: cells(staged.kinds, (v) => v.kind),
    criteria: staged.criteria,
    criteriaMeta: staged.criteriaMeta,
    rules: cells(staged.rules, (v) => v.table),
    ruleAssignments: cells(staged.ruleAssignments, (v) => v.rule),
    catalogs: cells(staged.catalogs, (v) => v.table),
    assumptions: staged.assumptions as WorkLayer["assumptions"],
  };
}
