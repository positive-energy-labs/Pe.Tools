/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptExecutionSourceKind } from "./script-execution-source-kind.js";

export interface ExecuteRevitScriptRequest {
  scriptContent?: string;
  sourceKind: ScriptExecutionSourceKind;
  sourcePath?: string;
  workspaceKey: string;
  sourceName?: string;
}
