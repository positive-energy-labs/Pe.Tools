/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { DocumentInvalidationReason } from "./document-invalidation-reason.js";

export interface DocumentInvalidationEvent {
  reason: DocumentInvalidationReason;
  documentTitle?: string;
  documentKey?: string;
  documentPath?: string;
  documentIsFamilyDocument: boolean;
  documentIsWorkshared: boolean;
  documentIsModelInCloud: boolean;
  documentCloudProjectGuid?: string;
  documentCloudModelGuid?: string;
  documentCloudModelUrn?: string;
  hasActiveDocument: boolean;
  openDocumentCount: number;
  documentObservedAtUnixMs: number;
  sessionId?: string;
  revitVersion?: string;
}
