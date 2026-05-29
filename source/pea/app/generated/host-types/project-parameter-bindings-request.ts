/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamiliesFilter } from "./loaded-families-filter.js";
import type { ProjectParameterBindingsFilter } from "./project-parameter-bindings-filter.js";
import type { RevitDataProjectionRequest } from "./revit-data-projection-request.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ProjectParameterBindingsRequest {
  filter?: LoadedFamiliesFilter;
  bindingFilter?: ProjectParameterBindingsFilter;
  projection?: RevitDataProjectionRequest;
  budget?: RevitDataOutputBudget;
}
