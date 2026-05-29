/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectParameterBindingsSummary } from "./project-parameter-bindings-summary.js";
import type { ProjectParameterBindingEntry } from "./project-parameter-binding-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ProjectParameterBindingsData {
  summary: ProjectParameterBindingsSummary;
  entries: ProjectParameterBindingEntry[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
