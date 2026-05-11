/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptExecutionStatus } from "./script-execution-status.js";
import type { ScriptDiagnostic } from "./script-diagnostic.js";

export interface ExecuteRevitScriptData {
  status: ScriptExecutionStatus;
  output: string;
  diagnostics: ScriptDiagnostic[];
  revitVersion: string;
  targetFramework: string;
  containerTypeName?: string;
  executionId: string;
}
