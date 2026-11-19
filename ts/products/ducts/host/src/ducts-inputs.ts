/**
 * The host side of the inputs resolver (ducts LEDGER 2026-10-29): load the layers the pure
 * `resolveInputs` reads (Work's staged edits, the firm file) and turn a sheet's `edits` into Work
 * patches. `Settings/ducts.json` in the project home, then in the firm home (read through `ctx.files.firm`),
 * is the base under Work; a criterion neither states runs on the engine default
 * below and is labelled `default`, so a sheet never prices on an unnamed constant.
 */
import {
  DUCTS_CRITERIA_CELLS,
  serveSetting,
  type DuctsCriteriaCell,
  type DuctsFirm,
  type DuctsFirmFile,
  type SettingTierRead,
} from "@pe/agent-contracts";
import type { FirmValue } from "@pe/host/read-graph";

import { FIRM_SEED } from "@pe/ducts-domain/input-layers";
export { FIRM_SEED, workLayer } from "@pe/ducts-domain/input-layers";

/** The ducts firm file as read through `ctx.files.firm("ducts", …)` / `DuctFiles.firm("ducts")`, or refused without a firm home. */
export type FirmReading = FirmValue<DuctsFirmFile>;

/**
 * The base layer a resolver runs on (ADR 0037 rule 8): each criterion from the project home's file,
 * else the firm home's, else the engine default, with the tier that served it. A firm home that was
 * not found, or holds no file, serves nothing: its criteria are `default`, never `firm`.
 */
export function firmLayer(reading: FirmReading, settings: readonly SettingTierRead[]): DuctsFirm {
  const firmFile = "refused" in reading || !reading.present ? null : reading.firm;
  const criteria: Record<string, unknown> = structuredClone(FIRM_SEED.criteria);
  const served: Record<string, "project" | "firm" | "default"> = {};
  for (const [cell, declared] of Object.entries(DUCTS_CRITERIA_CELLS)) {
    const [key, side] = declared.layer;
    const { value, tier } = serveSetting<number | string>(settings, ["project", "firm"], ["criteria", ...declared.layer], declared.value);
    served[cell as DuctsCriteriaCell] = tier as "project" | "firm" | "default";
    if (value == null) continue;
    if (side) (criteria[key] as Record<string, unknown>)[side] = value;
    else criteria[key] = value;
  }
  return { version: firmFile?.version ?? (firmFile ? "firm" : FIRM_SEED.version), criteria: criteria as DuctsFirm["criteria"], served };
}

export { editPatches } from "@pe/ducts-domain/calc/edits";
