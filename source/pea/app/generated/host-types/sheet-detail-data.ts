/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SheetDetailEntry } from "./sheet-detail-entry.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface SheetDetailData {
  sheets: SheetDetailEntry[];
  page: RevitDataResultPage;
  issues: RevitDataIssue[];
}
