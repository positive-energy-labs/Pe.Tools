/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { RevitAgentViewSheetPlacement } from "./revit-agent-view-sheet-placement.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface RevitAgentActiveViewContext {
  handle: RevitAgentContextHandle;
  viewType: string;
  title: string;
  scale: number;
  levelName?: string;
  discipline?: string;
  phaseName?: string;
  viewTemplateName?: string;
  isTemplate: boolean;
  canBePrinted: boolean;
  isSheet: boolean;
  isSchedule: boolean;
  sheetPlacements: RevitAgentViewSheetPlacement[];
  provenance: RevitAgentContextProvenance[];
}
