/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { ProjectBrowserPathLevel } from "./project-browser-path-level.js";
import type { ProjectBrowserFolderSummary } from "./project-browser-folder-summary.js";

export interface ProjectBrowserOrganizationSummary {
  section: ProjectBrowserSection;
  organizationName?: string;
  sortingParameterId?: number;
  sortingParameterName?: string;
  sortingOrder?: string;
  indexedElementCount: number;
  folderCount: number;
  pathLevels: ProjectBrowserPathLevel[];
  folders: ProjectBrowserFolderSummary[];
}
