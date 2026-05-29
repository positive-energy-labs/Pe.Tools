/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogEntry } from "./schedule-catalog-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ScheduleCatalogData {
  entries: ScheduleCatalogEntry[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
