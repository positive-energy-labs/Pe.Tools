/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamilyPlacementScope } from "./loaded-family-placement-scope.js";

export interface LoadedFamiliesFilter {
  familyNames: string[];
  familyNameContains?: string;
  categoryNames: string[];
  categoryNameContains?: string;
  placementScope: LoadedFamilyPlacementScope;
}
