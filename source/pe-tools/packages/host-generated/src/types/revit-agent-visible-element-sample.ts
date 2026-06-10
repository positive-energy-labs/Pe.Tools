/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface RevitAgentVisibleElementSample {
  handle: RevitAgentContextHandle;
  className: string;
  familyName?: string;
  typeName?: string;
  levelName?: string;
  provenance?: RevitAgentContextProvenance[];
  visibleInViews?: RevitAgentContextHandle[];
}
