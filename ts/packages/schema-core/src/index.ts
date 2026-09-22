import {
  applySchemaDefaultsToValue,
  buildDefaultValuesFromSchema,
  removeSchemaDefaultsFromValue,
} from "./core/defaults.ts";
import type { RenderSchemaNode } from "./core/types.ts";
import { SchemaDocument } from "./runtime/schema-document.ts";

export type {
  FieldHint,
  NormalizedFieldOptionDataset,
  NormalizedFieldOptionDependencyScope,
  NormalizedFieldOptionMode,
  NormalizedFieldOptionResolver,
  NormalizedRenderFieldOptionDependency,
  NormalizedRenderFieldOptionSource,
  NormalizedRenderDynamicColumnOrder,
  NormalizedRenderUiBehavior,
  NormalizedRenderUiLayout,
  NormalizedRenderUiMetadata,
  RenderFieldOptionDependency,
  RenderFieldOptionSource,
  RenderSchemaNode,
  SchemaPrimitiveType,
} from "./core/types.ts";
export {
  getFieldHint,
  getFieldLabel,
  getFieldOptionSource,
  getFieldOrder,
  getFieldPlaceholder,
  getUiMetadata,
  normalizeFieldOptionMode,
  readPathValue,
} from "./ui-mappers/extensions.ts";
export { applySchemaDefaultsToValue, buildDefaultValuesFromSchema, removeSchemaDefaultsFromValue };
export { SchemaDocument, SchemaNodeRef } from "./runtime/schema-document.ts";

export function parseSchema(schemaJson: string): RenderSchemaNode | undefined {
  return SchemaDocument.parse(schemaJson)?.rawRoot();
}

export function parseSchemaDocument(schemaJson: string): SchemaDocument | undefined {
  return SchemaDocument.parse(schemaJson);
}
