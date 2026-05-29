/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitAgentContextCandidate } from "./revit-agent-context-candidate.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface RevitAgentContextResolveData {
  referenceText: string;
  candidateCount: number;
  candidates: RevitAgentContextCandidate[];
  issues: RevitDataIssue[];
}
