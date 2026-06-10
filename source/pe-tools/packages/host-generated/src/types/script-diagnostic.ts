/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptDiagnosticSeverity } from "./script-diagnostic-severity.js";

export interface ScriptDiagnostic {
  stage: string;
  severity: ScriptDiagnosticSeverity;
  message: string;
  source?: string;
}
