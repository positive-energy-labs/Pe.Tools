/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsDocumentId } from "./settings-document-id.js";
import type { SettingsDirectiveScope } from "./settings-directive-scope.js";
import type { SettingsDocumentDependencyKind } from "./settings-document-dependency-kind.js";

export interface SettingsDocumentDependency {
  documentId: SettingsDocumentId;
  directivePath: string;
  scope: SettingsDirectiveScope;
  kind: SettingsDocumentDependencyKind;
}
