/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { SettingsFileEntry } from "./settings-file-entry.js";
import type { SettingsDirectoryNode } from "./settings-directory-node.js";

export interface SettingsDiscoveryResult {
  files: SettingsFileEntry[];
  root: SettingsDirectoryNode;
}
