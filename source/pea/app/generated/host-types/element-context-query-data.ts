/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementContextQueryKind } from "./element-context-query-kind.js";
import type { ElementContextEntry } from "./element-context-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface ElementContextQueryData {
  documentTitle: string;
  isFamilyDocument: boolean;
  queryKind: ElementContextQueryKind;
  requestedElementCount: number;
  resolvedElementCount: number;
  entries: ElementContextEntry[];
  issues: RevitDataIssue[];
}
