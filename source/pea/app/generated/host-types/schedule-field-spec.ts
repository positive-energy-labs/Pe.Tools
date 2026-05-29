/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleAuthoredFieldDisplayType } from "./schedule-authored-field-display-type.js";
import type { ScheduleFieldHorizontalAlignment } from "./schedule-field-horizontal-alignment.js";
import type { ScheduleAuthoredCalculatedFieldType } from "./schedule-authored-calculated-field-type.js";
import type { ScheduleFieldFormatSpec } from "./schedule-field-format-spec.js";
import type { CombinedParameterSpec } from "./combined-parameter-spec.js";

export interface ScheduleFieldSpec {
  parameterName: string;
  columnHeaderOverride?: string;
  headerGroup?: string;
  isHidden: boolean;
  displayType: ScheduleAuthoredFieldDisplayType;
  columnWidth?: number;
  horizontalAlignment: ScheduleFieldHorizontalAlignment;
  calculatedType?: ScheduleAuthoredCalculatedFieldType;
  percentageOfField?: string;
  formatOptions?: ScheduleFieldFormatSpec;
  combinedParameters: CombinedParameterSpec[];
}
