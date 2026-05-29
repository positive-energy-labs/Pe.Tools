/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SheetSummary } from "./sheet-summary.js";
import type { SheetAnchor } from "./sheet-anchor.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface SheetDetailEntry {
  summary: SheetSummary;
  anchors: SheetAnchor[];
  issues: RevitDataIssue[];
}
