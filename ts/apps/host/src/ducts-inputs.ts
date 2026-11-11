/**
 * The host side of the inputs resolver (ducts LEDGER 2026-10-29): load the layers the pure
 * `resolveInputs` reads (Work's staged edits, the firm file) and turn a sheet's `edits` into Work
 * patches. The firm file is the base layer under every project criterion; absent, the seed below
 * stands in and says so (`present: false`), so a sheet never prices on an unnamed constant.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sharedFirmDir } from "@pe/host-contracts/product-paths";
import {
  ductsFirmSchema,
  stagedDucts,
  type DuctsFirm,
  type DuctsDesign,
} from "@pe/agent-contracts";
import { type WorkLayer } from "@pe/ducts-domain/sheet/index";

/** `<shared>\Firm\ducts.json`, a shared setting with no user layer (ADR 0035 rule 11); null without a shared root. */
export const firmFilePath = (): string | null => {
  const dir = sharedFirmDir();
  return dir && join(dir, "ducts.json");
};

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

export type FirmReading =
  | {
      firm: DuctsFirm;
      path: string;
      present: boolean;
      /** Why the file was not used, when it exists and does not parse. */
      error?: string;
    }
  /** No shared root: the firm file has no home, so the read refuses rather than seeding silently. */
  | { refused: "no-shared-root" };

/** The firm layer a resolver runs on: the reading's firm, or the named seed when the read refused. */
export const firmLayer = (reading: FirmReading): DuctsFirm =>
  "refused" in reading ? FIRM_SEED : reading.firm;

/** The `DuctFiles` layer body; callers read the firm through `DuctFiles`, never this. */
export async function readFirm(path = firmFilePath()): Promise<FirmReading> {
  if (path === null) return { refused: "no-shared-root" };
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { firm: FIRM_SEED, path, present: false };
    return { firm: FIRM_SEED, path, present: false, error: String(error) };
  }
  // Malformed JSON is the same visible refusal as a schema miss, never a thrown defect.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { firm: FIRM_SEED, path, present: false, error: String(error) };
  }
  const parsed = ductsFirmSchema.safeParse(json);
  if (!parsed.success)
    return { firm: FIRM_SEED, path, present: false, error: parsed.error.message };
  return { firm: parsed.data, path, present: true };
}

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
