/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectBrowserResultView } from "./project-browser-result-view.js";
import type { ProjectBrowserOrganizationSummary } from "./project-browser-organization-summary.js";
import type { ProjectBrowserItem } from "./project-browser-item.js";
import type { ProjectBrowserNearestMatch } from "./project-browser-nearest-match.js";
import type { RevitDataIssue } from "./revit-data-issue.js";
import type { RevitDataResultPage } from "./revit-data-result-page.js";

export interface ProjectBrowserData {
  browserSnapshotId: string;
  view: ProjectBrowserResultView;
  organizations: ProjectBrowserOrganizationSummary[];
  items: ProjectBrowserItem[];
  nearestMatches: ProjectBrowserNearestMatch[];
  issues: RevitDataIssue[];
  page?: RevitDataResultPage;
}
