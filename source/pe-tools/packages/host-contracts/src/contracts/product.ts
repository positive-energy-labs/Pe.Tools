// Hand-authored wire contract. Keep aligned with Pe.Shared.Product (C#) — the codegen that
// once produced this file is deleted; changes here are ordinary code review, not regeneration.

export const productIdentity = {
  vendorName: "Positive Energy",
  productName: "Pe.Tools",
  userVisibleProductName: "Pe.Tools",
} as const;

export const productPathNames = {
  binDirectoryName: "bin",
  developmentDirectoryName: "dev",
  hostDirectoryName: "host",
  peaDirectoryName: "pea",
  stateDirectoryName: "state",
  logsDirectoryName: "logs",
  cacheDirectoryName: "cache",
  settingsDirectoryName: "settings",
  workspacesDirectoryName: "workspaces",
  inlineScriptsDirectoryName: "inline-scripts",
  outputDirectoryName: "output",
  globalDirectoryName: "Global",
  agentInstructionsFileName: "AGENTS.md",
  readmeFileName: "README.md",
  podManifestFileName: "pod.json",
  hostLogFileName: "host.log.txt",
  revitAppLogFileName: "revit.log.txt",
} as const;

export const hostProcessIdentity = {
  directoryName: "host",
  executableName: "Pe.Host.exe",
  frontendBaseUrlVariable: "PE_TOOLS_FRONTEND_BASE_URL",
  hostBaseUrlVariable: "PE_TOOLS_HOST_BASE_URL",
  hostExecutablePathVariable: "PE_TOOLS_HOST_EXECUTABLE_PATH",
  defaultFrontendBaseUrl: "http://localhost:5150",
  defaultHostBaseUrl: "http://127.0.0.1:5180",
} as const;

export const peaCliIdentity = {
  directoryName: "pea",
  launcherName: "pea.cmd",
  appDirectoryName: "app",
  installedExecutableName: "pea.exe",
  currentVersionFileName: "current.txt",
  devSourceFileName: "dev-source.txt",
  versionsDirectoryName: "versions",
  packagesDirectoryName: "packages",
  payloadManifestFileName: "pea-payload.json",
  payloadManifestSchemaVersion: 1,
} as const;

export const peDevCliIdentity = {
  directoryName: "pe-dev",
  executableName: "pe-dev.exe",
  dllName: "pe-dev.dll",
} as const;

export const revitDeploymentIdentity = {
  addinManifestFileName: "Pe.App.addin",
  runtimeDescriptorFileName: "Pe.App.runtime.json",
  addinAssemblyDirectoryName: "Pe.App",
  autodeskDirectoryName: "Autodesk",
  revitDirectoryName: "Revit",
  addinsDirectoryName: "Addins",
} as const;

export const peAppRuntimeDeploymentDescriptor = {
  currentSchemaVersion: 1,
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
