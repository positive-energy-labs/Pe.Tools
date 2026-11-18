/** The path engine (MAP step 3): one sheet per roster fan port, or one asserted chain. */
export * from "./types.ts";
export {
  buildCalc,
  buildChain,
  type BuildCalcInput,
  type BuildChainInput,
  type PricingInput,
  type CalcSnapshot,
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
} from "@pe/ducts-domain/calc/inputs";

export {
  ENCOUNTERS,
  ENCOUNTER_KEY,
  encountersOf,
  hostStatic,
  type EncounterRuling,
  type HostCalc,
} from "./encounters.ts";
export { editPatches } from "@pe/ducts-domain/calc/edits";

export type { CompleteClaim, DomainClaim } from "./encounters.ts";
export { mintWriteRequest, type FanWriteRequest, type FanWriteContext } from "./write-request.ts";
