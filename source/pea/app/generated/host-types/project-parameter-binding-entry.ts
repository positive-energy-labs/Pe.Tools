/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentity } from "./parameter-identity.js";
import type { ProjectParameterBindingKind } from "./project-parameter-binding-kind.js";

export interface ProjectParameterBindingEntry {
  identity: ParameterIdentity;
  bindingKind: ProjectParameterBindingKind;
  dataTypeId?: string;
  dataTypeLabel?: string;
  groupTypeId?: string;
  groupTypeLabel?: string;
  categoryNames: string[];
}
