/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCoverageElementEntry } from "./schedule-coverage-element-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ScheduleCoverageData {
  totalElements: number;
  coveredElements: number;
  missingElements: number;
  scheduleCount: number;
  elements: ScheduleCoverageElementEntry[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
