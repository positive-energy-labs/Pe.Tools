/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectIndexSection } from "./project-index-section.js";
import type { ProjectBrowserFilter } from "./project-browser-filter.js";
import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { RevitDataProjectionRequest } from "./revit-data-projection-request.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ProjectIndexRequest {
  sections: ProjectIndexSection[];
  searchText?: string;
  levelNames: string[];
  sheetNumberContains: string[];
  sheetNameContains: string[];
  categoryNames: string[];
  familyNameContains: string[];
  scheduleNameContains: string[];
  includeUnplacedViews: boolean;
  includeUnplacedSchedules: boolean;
  includeBrowserProvenance: boolean;
  browserFilter?: ProjectBrowserFilter;
  browserSections: ProjectBrowserSection[];
  projection?: RevitDataProjectionRequest;
  budget?: RevitDataOutputBudget;
}
