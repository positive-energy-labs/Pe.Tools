/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitDataIssueSeverity } from "./revit-data-issue-severity.js";

export interface RevitDataIssue {
  code: string;
  severity: RevitDataIssueSeverity;
  message: string;
  familyName?: string;
  typeName?: string;
  parameterName?: string;
}
