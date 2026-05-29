/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SheetAnchorKind } from "./sheet-anchor-kind.js";
import type { RevitAgentContextHandle } from "./revit-agent-context-handle.js";
import type { SheetBounds } from "./sheet-bounds.js";
import type { RevitAgentContextProvenance } from "./revit-agent-context-provenance.js";

export interface SheetAnchor {
  kind: SheetAnchorKind;
  handle: RevitAgentContextHandle;
  label: string;
  bounds?: SheetBounds;
  targetHandle?: RevitAgentContextHandle;
  text?: string;
  parameters: { [key: string]: string; };
  provenance: RevitAgentContextProvenance[];
}
