/** The path engine (MAP step 3): one sheet per roster fan port, or one asserted chain. */
export * from "./types.ts";
export {
  buildSheet,
  buildChain,
  type BuildSheetInput,
  type BuildChainInput,
  type PricingInput,
  type SheetSnapshot,
} from "./build.ts";
export {
  resolveInputs,
  scopeInputs,
  resolveCriteria,
  terminalCfmOf,
  JOIN_KEY,
  END_KEY,
  PROPOSED_KEY,
  FITTING_DROP_CELL,
  EDIT_SEGMENTS,
  editCells,
  encounterRulings,
  sourced,
  type InputLayers,
  type WorkLayer,
  type StoreLayer,
} from "./inputs.ts";

export {
  ENCOUNTERS,
  ENCOUNTER_KEY,
  encountersOf,
  hostStatic,
  type EncounterRuling,
  type HostCalc,
} from "./encounters.ts";
export { editPatches } from "./edits.ts";

export type { CompleteClaim, DomainClaim } from "./encounters.ts";
export { mintWriteRequest, type FanWriteRequest, type FanWriteContext } from "./write-request.ts";
