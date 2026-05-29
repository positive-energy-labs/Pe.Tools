/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitElementScope } from "./revit-element-scope.js";
import type { RevitParameterLookupPreference } from "./revit-parameter-lookup-preference.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ParameterCoverageRequest {
  categoryNames: string[];
  scope: RevitElementScope;
  elementIds: number[];
  elementUniqueIds: string[];
  parameterNames: string[];
  sharedGuids: string[];
  lookupPreference: RevitParameterLookupPreference;
  treatWhitespaceAsBlank: boolean;
  defaultValues: string[];
  budget?: RevitDataOutputBudget;
}
