/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { ProjectBrowserResultView } from "./project-browser-result-view.js";
import type { ProjectBrowserFilter } from "./project-browser-filter.js";
import type { RevitDataOutputBudget } from "./revit-data-output-budget.js";

export interface ProjectBrowserRequest {
  sections: ProjectBrowserSection[];
  view: ProjectBrowserResultView;
  filter?: ProjectBrowserFilter;
  browserSnapshotId?: string;
  budget?: RevitDataOutputBudget;
}
