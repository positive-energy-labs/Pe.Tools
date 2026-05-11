/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElectricalDemandFactorDefinitionEntry } from "./electrical-demand-factor-definition-entry.js";

export interface ElectricalLoadClassificationCatalogEntry {
  classificationId: number;
  classificationUniqueId: string;
  name: string;
  abbreviation?: string;
  motor: boolean;
  other: boolean;
  spaceLoadClass?: string;
  demandFactor?: ElectricalDemandFactorDefinitionEntry;
}
