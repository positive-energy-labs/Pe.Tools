/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScriptPodOriginData } from "./script-pod-origin-data.js";
import type { ScriptPodEntrypointData } from "./script-pod-entrypoint-data.js";

export interface ScriptPodManifestSummaryData {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  origin?: ScriptPodOriginData;
  entrypoints: ScriptPodEntrypointData[];
}
