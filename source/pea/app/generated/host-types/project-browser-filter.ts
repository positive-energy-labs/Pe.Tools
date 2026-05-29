/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { ProjectBrowserMatchMode } from "./project-browser-match-mode.js";

export interface ProjectBrowserFilter {
  section?: ProjectBrowserSection;
  path: string[];
  fields: { [key: string]: string; };
  matchMode: ProjectBrowserMatchMode;
}
