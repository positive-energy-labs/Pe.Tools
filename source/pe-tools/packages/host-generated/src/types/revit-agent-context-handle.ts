/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextHandleKind } from "./revit-agent-context-handle-kind.js";

export interface RevitAgentContextHandle {
  kind: RevitAgentContextHandleKind;
  documentKey: string;
  elementId?: number;
  uniqueId?: string;
  label: string;
  categoryName?: string;
}
