/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitDataProjectionRequest } from "./revit-data-projection-request.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface RevitDataRequestEnvelope<TFilter, TScope, TReference, TOptions> {
  filter?: TFilter;
  scope?: TScope;
  references: TReference[];
  projection?: RevitDataProjectionRequest;
  budget?: RevitDataOutputBudget;
  options?: TOptions;
}
