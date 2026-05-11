/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ScheduleFieldFormatSpec } from "./schedule-field-format-spec.js";
import type { CombinedParameterSpec } from "./combined-parameter-spec.js";

export interface ScheduleFieldSpec {
  parameterName: string;
  columnHeaderOverride: string;
  headerGroup: string;
  isHidden: boolean;
  displayType: string;
  columnWidth?: number;
  horizontalAlignment: string;
  calculatedType?: string;
  percentageOfField: string;
  formatOptions?: ScheduleFieldFormatSpec;
  combinedParameters?: CombinedParameterSpec[];
}
