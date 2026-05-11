/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentity } from "./parameter-identity.js";
import type { LoadedFamilyParameterKind } from "./loaded-family-parameter-kind.js";
import type { LoadedFamilyParameterScope } from "./loaded-family-parameter-scope.js";
import type { ExcludedParameterReason } from "./excluded-parameter-reason.js";
import type { FormulaState } from "./formula-state.js";

export interface LoadedFamilyExcludedParameterEntry {
  identity: ParameterIdentity;
  isInstance: boolean;
  kind: LoadedFamilyParameterKind;
  scope: LoadedFamilyParameterScope;
  excludedReason: ExcludedParameterReason;
  formulaState: FormulaState;
  formula?: string;
}
