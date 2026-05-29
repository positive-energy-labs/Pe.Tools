/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterCoverageParameterEntry } from "./parameter-coverage-parameter-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ParameterCoverageData {
  totalElements: number;
  parameters: ParameterCoverageParameterEntry[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
