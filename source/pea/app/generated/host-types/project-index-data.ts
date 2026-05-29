/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectIndexSummary } from "./project-index-summary.js";
import type { ProjectIndexLevelEntry } from "./project-index-level-entry.js";
import type { ProjectIndexSheetEntry } from "./project-index-sheet-entry.js";
import type { ProjectIndexViewEntry } from "./project-index-view-entry.js";
import type { ProjectIndexScheduleEntry } from "./project-index-schedule-entry.js";
import type { ProjectIndexCategoryEntry } from "./project-index-category-entry.js";
import type { ProjectIndexFamilyEntry } from "./project-index-family-entry.js";
import type { ProjectBrowserOrganizationSummary } from "./project-browser-organization-summary.js";
import type { ProjectIndexModelContext } from "./project-index-model-context.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ProjectIndexData {
  summary: ProjectIndexSummary;
  levels: ProjectIndexLevelEntry[];
  sheets: ProjectIndexSheetEntry[];
  views: ProjectIndexViewEntry[];
  schedules: ProjectIndexScheduleEntry[];
  categories: ProjectIndexCategoryEntry[];
  families: ProjectIndexFamilyEntry[];
  browserOrganizations: ProjectBrowserOrganizationSummary[];
  modelContext?: ProjectIndexModelContext;
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
