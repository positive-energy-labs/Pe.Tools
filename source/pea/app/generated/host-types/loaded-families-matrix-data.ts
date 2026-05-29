/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamilyMatrixFamily } from "./loaded-family-matrix-family.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface LoadedFamiliesMatrixData {
  families: LoadedFamilyMatrixFamily[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
