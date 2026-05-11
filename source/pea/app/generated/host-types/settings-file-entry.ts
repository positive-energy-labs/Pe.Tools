/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsFileKind } from "./settings-file-kind.js";

export interface SettingsFileEntry {
  path: string;
  relativePath: string;
  relativePathWithoutExtension: string;
  name: string;
  baseName: string;
  directory?: string;
  modifiedUtc: Date;
  kind: SettingsFileKind;
  isFragment: boolean;
  isSchema: boolean;
}
