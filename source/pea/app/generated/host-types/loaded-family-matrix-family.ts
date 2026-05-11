/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { LoadedFamilyTypeEntry } from "./loaded-family-type-entry.js";
import type { LoadedFamilyVisibleParameterEntry } from "./loaded-family-visible-parameter-entry.js";
import type { LoadedFamilyExcludedParameterEntry } from "./loaded-family-excluded-parameter-entry.js";
import type { RevitDataIssue } from "./revit-data-issue.js";

export interface LoadedFamilyMatrixFamily {
  familyId: number;
  familyUniqueId: string;
  familyName: string;
  categoryName?: string;
  placedInstanceCount: number;
  types: LoadedFamilyTypeEntry[];
  scheduleNames: string[];
  visibleParameters: LoadedFamilyVisibleParameterEntry[];
  excludedParameters: LoadedFamilyExcludedParameterEntry[];
  issues: RevitDataIssue[];
}
