/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitDocumentSessionContextData } from "./revit-document-session-context-data.js";
import type { RevitAgentActiveViewContext } from "./revit-agent-active-view-context.js";
import type { RevitAgentSelectionContext } from "./revit-agent-selection-context.js";
import type { RevitAgentBrowserSummary } from "./revit-agent-browser-summary.js";
import type { RevitAgentVisibleCategorySummary } from "./revit-agent-visible-category-summary.js";

export interface RevitAgentContextSummaryData {
  documents: RevitDocumentSessionContextData;
  activeView?: RevitAgentActiveViewContext;
  selection: RevitAgentSelectionContext;
  browser: RevitAgentBrowserSummary;
  visibleCategories: RevitAgentVisibleCategorySummary[];
}
