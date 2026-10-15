export {
  PeaCliCommands,
  buildCapabilities,
  bundledPeaSkills,
  createCapabilityCatalogSource,
  createRouteRegistrations,
  peDo,
  peFind,
  peRead,
  publishPeaSkills,
  peaProductTools,
  peaStandardSkillsRoot,
  resolvePeaProductHomePath,
  resolvePeaSkillPaths,
  resolvePeaStandardSkillsRoot,
} from "./pea/index.ts";
export type { CapabilityCatalogSource, RouteRegistration } from "./pea/index.ts";
export type { PeaCliCommandOptions } from "./pea/PeaCliCommands.ts";
export {
  adoptTerminalContext,
  discoverHostBaseUrl,
  resolveHostBaseUrl,
  resolveLaneAndRoot,
  resolveWorkspaceKey,
} from "./shared/host-config.ts";
export { HostRpcCaller } from "./shared/host-rpc-caller.ts";
export { startPeaMcp } from "./stdio.ts";
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
export { peaAgentInstructions } from "./pea/instructions.ts";
