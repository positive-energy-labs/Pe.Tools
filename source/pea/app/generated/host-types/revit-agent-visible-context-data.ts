/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { RevitAgentVisibleCategorySummary } from "./revit-agent-visible-category-summary.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface RevitAgentVisibleContextData {
  activeView?: RevitAgentContextHandle;
  totalVisibleElementCount: number;
  categories: RevitAgentVisibleCategorySummary[];
  issues: RevitDataIssue[];
}
