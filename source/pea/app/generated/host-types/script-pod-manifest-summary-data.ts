/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptPodEntrypointData } from "./script-pod-entrypoint-data.js";

export interface ScriptPodManifestSummaryData {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  entrypoints: ScriptPodEntrypointData[];
}
