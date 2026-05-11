/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { RevitDocumentSummary } from "./revit-document-summary.js";

export interface RevitDocumentSessionContextData {
  hasActiveDocument: boolean;
  activeDocument?: RevitDocumentSummary;
  openDocumentCount: number;
  openDocuments: RevitDocumentSummary[];
}
