/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SheetReferenceRequest } from "./sheet-reference-request.js";
import type { SheetDetailProjection } from "./sheet-detail-projection.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface SheetDetailRequest {
  references?: SheetReferenceRequest;
  projection?: SheetDetailProjection;
  budget?: RevitDataOutputBudget;
}
