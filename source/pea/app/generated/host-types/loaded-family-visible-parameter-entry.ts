/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentity } from "./parameter-identity.js";
import type { LoadedFamilyParameterKind } from "./loaded-family-parameter-kind.js";
import type { LoadedFamilyParameterScope } from "./loaded-family-parameter-scope.js";
import type { FormulaState } from "./formula-state.js";

export interface LoadedFamilyVisibleParameterEntry {
  identity: ParameterIdentity;
  isInstance: boolean;
  kind: LoadedFamilyParameterKind;
  scope: LoadedFamilyParameterScope;
  storageType: string;
  dataTypeId?: string;
  dataTypeLabel?: string;
  groupTypeId?: string;
  groupTypeLabel?: string;
  formulaState: FormulaState;
  formula?: string;
  valuesByType: { [key: string]: string; };
}
