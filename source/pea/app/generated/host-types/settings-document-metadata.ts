/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsDocumentId } from "./settings-document-id.js";
import type { SettingsFileKind } from "./settings-file-kind.js";
import type { SettingsVersionToken } from "./settings-version-token.js";

export interface SettingsDocumentMetadata {
  documentId: SettingsDocumentId;
  kind: SettingsFileKind;
  modifiedUtc?: Date;
  versionToken?: SettingsVersionToken;
}
