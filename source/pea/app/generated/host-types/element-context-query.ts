/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ElementContextQueryKind } from "./element-context-query-kind.js";
import type { RequestedParameterQuery } from "./requested-parameter-query.js";

export interface ElementContextQuery {
  kind: ElementContextQueryKind;
  elementIds?: number[];
  elementUniqueIds?: string[];
  parameterQuery?: RequestedParameterQuery;
}
