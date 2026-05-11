/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { ProjectParameterBindingsData } from "./project-parameter-bindings-data.js";
import type { LoadedFamiliesMatrixData } from "./loaded-families-matrix-data.js";

export interface ParameterCollectionArtifact {
  runId: string;
  engine: string;
  region: string;
  projectGuid: string;
  modelGuid: string;
  documentTitle?: string;
  documentPath?: string;
  cloudModelUrn?: string;
  collectedAtUtc: string;
  projectParameterBindings: ProjectParameterBindingsData;
  loadedFamiliesMatrix: LoadedFamiliesMatrixData;
}
