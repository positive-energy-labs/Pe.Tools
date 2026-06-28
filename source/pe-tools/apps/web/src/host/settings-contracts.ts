/**
 * Settings boundary facade. Operation request/response types and schema
 * extension metadata are C#-generated; this file keeps route-facing aliases.
 */

export type {
  FieldOptionItem,
  FieldOptionsData,
  FieldOptionsRequest,
  OpenSettingsDocumentRequest,
  ParameterCatalogData,
  ParameterCatalogEntry,
  ParameterCatalogRequest,
  SaveSettingsDocumentRequest,
  SaveSettingsDocumentResult,
  SchemaData,
  SchemaRequest,
  SettingsDiscoveryResult,
  SettingsDocumentDependency,
  SettingsDocumentId,
  SettingsDocumentSnapshot,
  SettingsFileEntry,
  SettingsModuleWorkspaceDescriptor,
  SettingsRootDescriptor,
  SettingsTreeRequest,
  SettingsValidationIssue,
  SettingsValidationResult,
  SettingsVersionToken,
  SettingsWorkspaceDescriptor,
  SettingsWorkspacesData,
  ValidateSettingsDocumentRequest,
} from "@pe/host-generated/zod";

export {
  SettingsFileKind,
  SettingsOptionsDependencyScope as FieldOptionsDependencyScope,
  SettingsOptionsMode as FieldOptionsMode,
  SettingsOptionsResolverKind as FieldOptionsResolverKind,
} from "@pe/host-generated/types";

export type {
  SchemaUiMetadata,
  SettingsOptionsDependency as FieldOptionsDependencySchema,
  SettingsValueDomainDescriptor as FieldOptionsSourceSchema,
} from "@pe/host-generated/zod";

export type FieldOptionsDatasetKind = string;
