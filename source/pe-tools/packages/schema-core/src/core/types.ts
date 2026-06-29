import type {
  SchemaUiMetadata,
  SettingsOptionsDependency as FieldOptionsDependencySchema,
  SettingsValueDomainDescriptor as FieldOptionsSourceSchema,
} from "@pe/host-generated/zod";

export interface FieldHint {
  label?: string;
  order?: number;
  group?: string;
  placeholder?: string;
}

export type RenderFieldOptionDependency = FieldOptionsDependencySchema;
export type RenderFieldOptionSource = FieldOptionsSourceSchema;
export type NormalizedFieldOptionMode = "suggestion" | "constraint";
export type NormalizedFieldOptionResolver = "remote" | "dataset";
export type NormalizedFieldOptionDataset = string;
export type NormalizedFieldOptionDependencyScope = "sibling" | "context";

export interface NormalizedRenderFieldOptionDependency {
  key: string;
  scope?: NormalizedFieldOptionDependencyScope;
}

export interface NormalizedRenderFieldOptionSource {
  key: string;
  resolver: NormalizedFieldOptionResolver;
  dataset?: NormalizedFieldOptionDataset;
  mode: NormalizedFieldOptionMode;
  allowsCustomValue: boolean;
  dependsOn: NormalizedRenderFieldOptionDependency[];
}

export interface NormalizedRenderDynamicColumnOrder {
  source?: string;
  values: string[];
}

export interface NormalizedRenderUiBehavior {
  fixedColumns: string[];
  dynamicColumnsFromAdditionalProperties?: boolean;
  missingValue?: string;
  dynamicColumnOrder?: NormalizedRenderDynamicColumnOrder;
}

export interface NormalizedRenderUiLayout {
  section?: string;
  advanced?: boolean;
}

export interface NormalizedRenderUiMetadata {
  renderer?: string;
  layout?: NormalizedRenderUiLayout;
  behavior?: NormalizedRenderUiBehavior;
}

export type SchemaPrimitiveType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface RenderSchemaNode {
  $id?: string;
  $schema?: string;
  $ref?: string;
  type?: SchemaPrimitiveType | SchemaPrimitiveType[];
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  examples?: unknown[];
  properties?: Record<string, RenderSchemaNode>;
  patternProperties?: Record<string, RenderSchemaNode>;
  required?: string[];
  items?: RenderSchemaNode;
  oneOf?: RenderSchemaNode[];
  anyOf?: RenderSchemaNode[];
  allOf?: RenderSchemaNode[];
  if?: RenderSchemaNode;
  then?: RenderSchemaNode;
  else?: RenderSchemaNode;
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, RenderSchemaNode>;
  format?: string;
  definitions?: Record<string, RenderSchemaNode>;
  $defs?: Record<string, RenderSchemaNode>;
  additionalProperties?: boolean | RenderSchemaNode;
  "x-display-name"?: string;
  "x-ui"?: SchemaUiMetadata;
  "x-options"?: RenderFieldOptionSource;
  [key: `x-${string}`]: unknown;
}
