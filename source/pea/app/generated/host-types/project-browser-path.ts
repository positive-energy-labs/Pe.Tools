/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserSection } from "./project-browser-section.js";
import type { ProjectBrowserPathSegment } from "./project-browser-path-segment.js";

export interface ProjectBrowserPath {
  section: ProjectBrowserSection;
  organizationName?: string;
  pathLabel: string;
  segments: ProjectBrowserPathSegment[];
}
