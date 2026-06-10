/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

export interface RevitDocumentSummary {
  documentKey: string;
  title: string;
  path?: string;
  isFamilyDocument: boolean;
  isWorkshared: boolean;
  isActive: boolean;
  isModifiable: boolean;
  isReadOnly: boolean;
  isModelInCloud: boolean;
  cloudProjectGuid?: string;
  cloudModelGuid?: string;
  cloudModelUrn?: string;
}
