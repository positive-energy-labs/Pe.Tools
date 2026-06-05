/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptPodManifestSummaryData } from "./script-pod-manifest-summary-data.js";
import type { ScriptDiagnostic } from "./script-diagnostic.js";

export interface ScriptPodExportData {
  workspaceKey: string;
  workspaceRootPath: string;
  archivePath: string;
  manifest: ScriptPodManifestSummaryData;
  archiveEntries: string[];
  diagnostics: ScriptDiagnostic[];
}
