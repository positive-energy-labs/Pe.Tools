/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ParameterIdentity } from "./parameter-identity.js";

export interface ParameterCatalogEntry {
  identity: ParameterIdentity;
  storageType: string;
  dataType?: string;
  isInstance: boolean;
  isParamService: boolean;
  familyNames: string[];
  typeNames: string[];
}
