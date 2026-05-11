/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleCatalogData } from "./schedule-catalog-data.js";
import type { ScheduleQueryData } from "./schedule-query-data.js";

export interface ScheduleCollectionArtifact {
  runId: string;
  engine: string;
  region: string;
  projectGuid: string;
  modelGuid: string;
  documentTitle?: string;
  documentPath?: string;
  cloudModelUrn?: string;
  collectedAtUtc: string;
  resolvedViaFallback: boolean;
  catalog: ScheduleCatalogData;
  query: ScheduleQueryData;
}
