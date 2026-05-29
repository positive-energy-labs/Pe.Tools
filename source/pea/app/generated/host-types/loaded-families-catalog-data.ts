/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamiliesCatalogSummary } from "./loaded-families-catalog-summary.js";
import type { LoadedFamilyCatalogEntry } from "./loaded-family-catalog-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface LoadedFamiliesCatalogData {
  summary: LoadedFamiliesCatalogSummary;
  families: LoadedFamilyCatalogEntry[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
