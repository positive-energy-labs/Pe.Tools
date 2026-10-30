/**
 * The host side of the inputs resolver (ducts LEDGER 2026-10-29): load the layers the pure
 * `resolveInputs` reads (Work's staged edits, the firm file) and turn a sheet's `edits` into Work
 * patches. The firm file is the base layer under every project criterion; absent, the seed below
 * stands in and says so (`present: false`), so a sheet never prices on an unnamed constant.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ductsFirmSchema,
  stagedDucts,
  type DuctsFirm,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import { type WorkLayer } from "@pe/ducts-domain/sheet/index";
import { productUserContentRootPath } from "./product-paths.ts";

export const firmFilePath = () => join(productUserContentRootPath(), "Firm", "ducts.json");

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

export interface FirmReading {
  firm: DuctsFirm;
  path: string;
  present: boolean;
  /** Why the file was not used, when it exists and does not parse. */
  error?: string;
}

export async function readFirm(path = firmFilePath()): Promise<FirmReading> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { firm: FIRM_SEED, path, present: false };
    return { firm: FIRM_SEED, path, present: false, error: String(error) };
  }
  const parsed = ductsFirmSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    return { firm: FIRM_SEED, path, present: false, error: parsed.error.message };
  return { firm: parsed.data, path, present: true };
}

/** Work's staged edits as the resolver reads them. */
export function workLayer(doc: DuctsRouteDocument | null): WorkLayer {
  const staged = stagedDucts(doc);
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
