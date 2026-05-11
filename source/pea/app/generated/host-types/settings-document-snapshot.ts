/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsDocumentMetadata } from "./settings-document-metadata.js";
import type { SettingsDocumentDependency } from "./settings-document-dependency.js";
import type { SettingsValidationResult } from "./settings-validation-result.js";

export interface SettingsDocumentSnapshot {
  metadata: SettingsDocumentMetadata;
  rawContent: string;
  composedContent?: string;
  dependencies: SettingsDocumentDependency[];
  validation: SettingsValidationResult;
  capabilityHints: { [key: string]: string; };
}
