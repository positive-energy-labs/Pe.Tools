/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsRootDescriptor } from "./settings-root-descriptor.js";
import type { SettingsModuleStorageOptionsContract } from "./settings-module-storage-options-contract.js";
import type { HostModuleScope } from "./host-module-scope.js";
import type { HostModuleActiveDocumentKind } from "./host-module-active-document-kind.js";

export interface SettingsModuleDescriptor {
  moduleKey: string;
  defaultRootKey: string;
  roots: SettingsRootDescriptor[];
  storageOptions: SettingsModuleStorageOptionsContract;
  scope: HostModuleScope;
  activeDocumentKind: HostModuleActiveDocumentKind;
}
