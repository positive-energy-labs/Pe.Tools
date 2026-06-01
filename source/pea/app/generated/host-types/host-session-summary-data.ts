/**
 * This is a TypeGen auto-generated file.
 * Any changes made to this file can be lost when this file is regenerated.
 */

import type { HostActiveDocumentSummary } from "./host-active-document-summary.js";
import type { HostRuntimeAssemblyData } from "./host-runtime-assembly-data.js";
import type { HostModuleDescriptor } from "./host-module-descriptor.js";
import type { HostWorkbenchResourcesData } from "./host-workbench-resources-data.js";

export interface HostSessionSummaryData {
  bridgeIsConnected: boolean;
  sessionId?: string;
  processId?: number;
  revitVersion?: string;
  runtimeFramework?: string;
  openDocumentCount: number;
  activeDocument?: HostActiveDocumentSummary;
  runtimeAssemblies: HostRuntimeAssemblyData[];
  availableModules: HostModuleDescriptor[];
  workbenchResources: HostWorkbenchResourcesData;
}
