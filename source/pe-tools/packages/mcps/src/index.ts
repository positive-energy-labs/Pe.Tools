export {
  PeaCliCommands,
  bundledPeaSkills,
  configurePeaProductToolContext,
  createRouteRegistrations,
  defaultPeaAgentModelId,
  materializeBundledPeaSkills,
  peaProductHomeEnvVar,
  peaProductToolProfile,
  peaProductTools,
  peaSkillPaths,
  peaStandardSkillsRoot,
  peaTools,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolvePeaStandardSkillsRoot,
} from "./pea/index.ts";
export type { RouteRegistration } from "./pea/index.ts";
export type { PeaCliCommandOptions } from "./pea/PeaCliCommands.ts";
export { resolveHostBaseUrl, resolveWorkspaceKey } from "./shared/host-config.ts";
export { HostRpcCaller } from "./shared/host-rpc-caller.ts";
export { peaProductToolCatalog } from "./tool-metadata.ts";
export {
  ScriptingTools,
  bootstrapScriptWorkspace,
  executeScriptViaHost,
  exportScriptPod,
  importScriptPod,
  scriptBootstrapInputSchema,
  scriptExecuteInputSchema,
  scriptPodExportInputSchema,
  scriptPodImportInputSchema,
} from "./shared/scripting.ts";
