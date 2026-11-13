import type { MeasuredValue } from "./schedule-grid-data.ts";
export interface ParamSpec {
  dataType?: string;
  shared?: boolean;
  sharedGuid?: string;
  sharedSpecId?: string;
  sharedVisible?: boolean;
  sharedUserModifiable?: boolean;
  tooltip?: string;
  propertiesGroup?: string;
  value?: string | number | boolean | MeasuredValue;
  formula?: string;
  /** Absent means TYPE (Revit's default). */
  isInstance?: boolean;
}

