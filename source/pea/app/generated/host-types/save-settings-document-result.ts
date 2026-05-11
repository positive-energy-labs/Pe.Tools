/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsDocumentMetadata } from "./settings-document-metadata.js";
import type { SettingsValidationResult } from "./settings-validation-result.js";

export interface SaveSettingsDocumentResult {
  metadata: SettingsDocumentMetadata;
  writeApplied: boolean;
  conflictDetected: boolean;
  conflictMessage?: string;
  validation: SettingsValidationResult;
}
