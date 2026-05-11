/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleProfile } from "./schedule-profile.js";
import type { ScheduleParameterUsageEntry } from "./schedule-parameter-usage-entry.js";
import type { ScheduleCatalogCustomParameterValue } from "./schedule-catalog-custom-parameter-value.js";

export interface ScheduleProfileQueryEntry {
  scheduleId: number;
  scheduleUniqueId: string;
  name: string;
  categoryName?: string;
  isTemplate: boolean;
  profile: ScheduleProfile;
  parameterUsages: ScheduleParameterUsageEntry[];
  customParameters: ScheduleCatalogCustomParameterValue[];
}
