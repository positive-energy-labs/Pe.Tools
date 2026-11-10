/**
 * The host side of the inputs resolver (ducts LEDGER 2026-10-29): load the layers the pure
 * `resolveInputs` reads (Work's staged edits, the firm file) and turn a sheet's `edits` into Work
 * patches. The firm file (`Firm/ducts.json`, read through `ctx.firm`) is the base layer under every
 * project criterion; absent, the seed below stands in and says so (`present: false`), so a sheet
 * never prices on an unnamed constant.
 */
import { stagedDucts, type DuctsFirm, type DuctsDesign } from "@pe/agent-contracts";
import { type WorkLayer } from "@pe/ducts-domain/sheet/index";

// firm-default: what a firm with no file yet runs on. Velocity limits are Manual D's rules of
// thumb (trunk 900 supply, 700 return); 0.03 in-wg is the grille placeholder; 3 in and 36 in are
// the Q5 auto-join gap and the Q6 heal box. The firm's own numbers belong in the file.
export const FIRM_SEED: DuctsFirm = {
  version: "seed",
  criteria: {
    velocityLimitFpm: { supply: 900, return: 700 },
    terminalDropInWg: 0.03,
    autoJoinGapIn: 3,
    healBoxIn: 36,
    splitPolicy: "even",
    allowanceInWg: { supply: 0, return: 0 },
  },
};

/** Work's staged edits as the resolver reads them. */
export function workLayer(design: DuctsDesign): WorkLayer {
  const staged = stagedDucts(design, design);
  return {
    flows: staged.flows,
    terminalDrops: staged.terminalDrops,
    componentDrops: staged.componentDrops,
    esp: staged.esp,
    equipmentFlows: staged.equipmentFlows,
    roles: staged.roles,
    kinds: staged.kinds,
    criteria: staged.criteria,
    rules: staged.rules,
    ruleAssignments: staged.ruleAssignments,
    catalogs: staged.catalogs,
    assumptions: staged.assumptions as WorkLayer["assumptions"],
  };
}

export { editPatches, mergeCriteria } from "@pe/ducts-domain/sheet/index";
