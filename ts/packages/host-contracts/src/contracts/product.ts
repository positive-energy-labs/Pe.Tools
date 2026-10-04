// Product identity and the installed layout are SDK-generated from product.payloads.json
// (vendor/generated/product.g.ts). This file holds only what the manifest does not declare:
// product-owned path names, transport env vars, and scripting identity.

import { payload, productIdentity as generatedIdentity } from "../vendor/generated/product.g.ts";

export const productIdentity = {
  ...generatedIdentity,
  userVisibleProductName: "Pe.Tools",
} as const;

export const productPathNames = {
  stateDirectoryName: "state",
  logsDirectoryName: "logs",
  cacheDirectoryName: "cache",
  preferencesFileName: "preferences.json",
  podsDirectoryName: "Pods",
  pagesDirectoryName: "Pages",
  settingsDirectoryName: "settings",
  assetsDirectoryName: "assets",
  outputDirectoryName: "output",
  globalDirectoryName: "Global",
  agentInstructionsFileName: "AGENTS.md",
  readmeFileName: "README.md",
  podManifestFileName: "pod.json",
  hostLogFileName: "host.log.txt",
  revitAppLogFileName: "revit.log.txt",
} as const;

const hostService = payload("VersionedApp", "host")?.service;
if (!hostService?.health || !hostService.shutdown || !hostService.preferredPort)
  throw new Error("product.payloads.json declares no complete host service block");

type RoutePath = `/${string}`;
const routePath = (value: string): RoutePath => {
  if (!value.startsWith("/")) throw new Error(`host service route must start with '/': ${value}`);
  return value as RoutePath;
};

export const hostProcessIdentity = {
  serviceName: "host",
  serviceNameVariable: "PE_TOOLS_HOST_SERVICE_NAME",
  healthPath: routePath(hostService.health),
  shutdownPath: routePath(hostService.shutdown),
  frontendBaseUrlVariable: "PE_TOOLS_FRONTEND_BASE_URL",
  hostBaseUrlVariable: "PE_TOOLS_HOST_BASE_URL",
  hostExecutablePathVariable: "PE_TOOLS_HOST_EXECUTABLE_PATH",
  defaultFrontendBaseUrl: "http://localhost:5150",
  defaultHostBaseUrl: `http://127.0.0.1:${hostService.preferredPort}`,
} as const;

export const scriptingWorkspaceIdentity = {
  defaultWorkspaceKey: "default",
  projectFileName: "PeScripts.csproj",
  agentInstructionsFileName: "AGENTS.md",
  readmeFileName: "README.md",
  podManifestFileName: "pod.json",
  sourceDirectoryName: "src",
  sampleScriptFileName: "SampleScript.cs",
  vsCodeDirectoryName: ".vscode",
  vsCodeSettingsFileName: "settings.json",
} as const;
