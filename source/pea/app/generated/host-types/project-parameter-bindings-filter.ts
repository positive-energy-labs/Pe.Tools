/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectParameterBindingKind } from "./project-parameter-binding-kind.js";

export interface ProjectParameterBindingsFilter {
  parameterNames: string[];
  parameterNameContains?: string;
  categoryNames: string[];
  sharedGuids: string[];
  bindingKind?: ProjectParameterBindingKind;
}
