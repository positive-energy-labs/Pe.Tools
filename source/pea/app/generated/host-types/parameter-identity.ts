/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentityKind } from "./parameter-identity-kind.js";

export interface ParameterIdentity {
  key: string;
  kind: ParameterIdentityKind;
  name: string;
  builtInParameterId?: number;
  sharedGuid?: string;
  parameterElementId?: number;
}
