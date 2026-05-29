/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleTitleStyleSpec } from "./schedule-title-style-spec.js";
import type { ScheduleColumnHeaderVerticalAlignment } from "./schedule-column-header-vertical-alignment.js";
import type { ScheduleFieldSpec } from "./schedule-field-spec.js";
import type { ScheduleSortGroupSpec } from "./schedule-sort-group-spec.js";
import type { ScheduleFilterSpec } from "./schedule-filter-spec.js";
import type { ScheduleOnFinishSettings } from "./schedule-on-finish-settings.js";

export interface ScheduleProfile {
  name: string;
  categoryName: string;
  viewTemplateName?: string;
  titleStyle: ScheduleTitleStyleSpec;
  isItemized: boolean;
  filterBySheet: boolean;
  columnHeaderVerticalAlignment: ScheduleColumnHeaderVerticalAlignment;
  fields: ScheduleFieldSpec[];
  sortGroup: ScheduleSortGroupSpec[];
  filters: ScheduleFilterSpec[];
  onFinishSettings?: ScheduleOnFinishSettings;
}
