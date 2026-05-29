/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentVisibleContextScope } from "./revit-agent-visible-context-scope.js";

export interface RevitAgentVisibleContextRequest {
  maxCategories: number;
  categoryNames?: string[];
  maxSampleElementsPerCategory: number;
  scope: RevitAgentVisibleContextScope;
  viewIds?: number[];
  viewUniqueIds?: string[];
  maxViews: number;
  maxElementHandlesPerCategory: number;
}
