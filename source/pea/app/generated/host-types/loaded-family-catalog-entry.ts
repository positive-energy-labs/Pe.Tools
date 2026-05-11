/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamilyTypeEntry } from "./loaded-family-type-entry.js";

export interface LoadedFamilyCatalogEntry {
  familyId: number;
  familyUniqueId: string;
  familyName: string;
  categoryName?: string;
  typeCount: number;
  placedInstanceCount: number;
  types: LoadedFamilyTypeEntry[];
}
