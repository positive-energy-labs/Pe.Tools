import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { cli, define } from "gunshi";
import {
  createPeHostClient,
  defaultHostBaseUrl,
  defaultWorkspaceKey,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";
import {
  HostLogTarget,
  PeHostClientError,
  ScriptExecutionSourceKind,
  ScriptPermissionMode,
} from "./host-client.js";
import type { PeaAuthSource } from "./beta-auth-bootstrap.js";
import type {
  HostLogsData,
  HostProbeData,
  HostSessionSummaryData,
  ScriptDiagnostic,
  ScriptPodExportData,
  ScriptPodImportData,
} from "./host-client.js";
import {
  hostProcessIdentity,
  peaCliIdentity,
  productIdentity,
} from "./generated/product.generated.js";
import { callHostOperation, searchHostOperationMatches, type HostOperationCallResult } from "./host-operation-runtime.js";
import { ensurePeaRuntimeDefaults, getPeaRuntimeDefaultsSummary, type PeaRuntimeDefaultsSummary } from "./pea-runtime-defaults.js";
import {
  collectRuntimeLoopContext,
  defaultLiveLoopTimeoutSeconds,
  defaultRiderBridgeBaseUrl,
  restartLiveRrd,
  syncLiveRrd,
  type LiveRrdOpenDocumentSelector,
  type LiveRrdRestartReadinessLevel,
} from "./tools/shared/live-loop.js";

interface PeHostStatusSnapshot {
  probe: HostProbeData;
  sessionSummary: HostSessionSummaryData;
}

interface PeaPayloadManifest {
  schemaVersion: number;
  productName: string;
  payloadName: string;
  version: string;
  archiveFileName: string;
  sha256: string;
  sizeBytes: number;
  createdUtc: string;
  commitSha?: string | null;
}

const commonArgs = {
  host: {
    type: "string",
    description: "Pe.Host base URL.",
    default: resolveHostBaseUrl(),
  },
  workspace: {
    type: "string",
    description: "Pe scripting workspace key.",
    default: resolveWorkspaceKey(),
  },
} as const;

const agentArgs = {
  ...commonArgs,
  workspaceRoot: {
    type: "string",
    description: "Explicit Pea cwd override. Defaults to the product home returned by Pe.Host bootstrap.",
  },
  allowOauthBetaAuth: {
    type: "boolean",
    description: "Dev escape hatch: allow stored MastraCode Codex OAuth auth instead of requiring OPENAI_API_KEY for beta startup.",
    default: false,
  },
  authSource: {
    type: "string",
    description: "Model auth source: api-key, oauth, or auto. Defaults to the siloed API-key profile.",
    default: "api-key",
  },
} as const;

const devAgentArgs = {
  ...commonArgs,
  workspaceRoot: {
    type: "string",
    description: "Repo root for dev-agent. Defaults to the current directory.",
  },
} as const;

const agentCommand = define({
  name: "agent",
  description: "Start Pea, the deployed Revit/operator workbench.",
  args: agentArgs,
  toKebab: true,
  examples: [
    "pea agent",
    "pea agent --workspace default",
    "pea agent --auth-source api-key",
    "pea agent --auth-source oauth",
    "pea agent --allow-oauth-beta-auth",
    "pea agent --workspace-root C:\\Users\\you\\Documents\\Pe.Tools\\workspaces\\default",
  ].join("\n"),
  run: async (ctx) => {
    const { runPeAgent } = await import("./agent.js");
    await runPeAgent({
      hostBaseUrl: ctx.values.host,
      workspaceKey: ctx.values.workspace,
      workspaceRoot: ctx.values.workspaceRoot,
      allowOauthBetaAuth: ctx.values.allowOauthBetaAuth,
      authSource: parsePeaAuthSource(ctx.values.authSource),
    });
  },
});

const devCommand = define({
  name: "dev",
  description: "Start dev-agent, the MastraCode-based Pe.Tools repo coding agent with Pea black-box feedback tools.",
  args: devAgentArgs,
  toKebab: true,
  examples: [
    "pea dev",
    "pea dev --workspace-root C:\\Users\\you\\source\\repos\\Pe.Tools",
  ].join("\n"),
  run: async (ctx) => {
    const { runDevAgent } = await import("./dev-agent.js");
    await runDevAgent({
      hostBaseUrl: ctx.values.host,
      workspaceKey: ctx.values.workspace,
      workspaceRoot: ctx.values.workspaceRoot,
    });
  },
});

const devAgentCommand = define({
  name: "dev-agent",
  description: "Compatibility alias for `pea dev`; repo-only, not deployed Pea.",
  args: devAgentArgs,
  toKebab: true,
  examples: [
    "pea dev-agent",
    "pea dev-agent --workspace-root C:\\Users\\you\\source\\repos\\Pe.Tools",
  ].join("\n"),
  run: async (ctx) => {
    const { runDevAgent } = await import("./dev-agent.js");
    await runDevAgent({
      hostBaseUrl: ctx.values.host,
      workspaceKey: ctx.values.workspace,
      workspaceRoot: ctx.values.workspaceRoot,
    });
  },
});

const hostStatusCommand = define({
  name: "status",
  description: "Print Pe.Host, Revit session, and agent environment locations.",
  args: {
    host: commonArgs.host,
    workspace: commonArgs.workspace,
    json: {
      type: "boolean",
      description: "Print the raw host status DTO as JSON.",
      default: false,
    },
  },
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const status = await getHostStatus(hostBaseUrl);
    if (ctx.values.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    writeStatus(status);
  },
});

const hostLogsCommand = define({
  name: "logs",
  description: "Print Pe.Host/Revit logs through the generated TypeScript host client.",
  args: {
    host: commonArgs.host,
    target: {
      type: "string",
      description: "Log target: host, revit, or all.",
      default: "all",
    },
    tail: {
      type: "number",
      description: "Number of lines to print per log file.",
      default: 200,
    },
    json: {
      type: "boolean",
      description: "Print the raw host logs DTO as JSON.",
      default: false,
    },
  },
  examples: ["pea host logs", "pea host logs --target revit --tail 50"].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const logs = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).host.getLogs({
        target: parseLogTarget(ctx.values.target),
        tailLineCount: ctx.values.tail,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }

    writeLogs(logs);
  },
});

const operationSearchArgs = {
  query: {
    type: "string",
    description: "Optional search query.",
  },
  domain: {
    type: "string",
    description: "Optional exact top-level domain filter, such as revit, host, settings, script, or aps.",
  },
  intent: {
    type: "string",
    description: "Optional intent filter: Read or Mutate.",
  },
  limit: {
    type: "number",
    description: "Maximum operations to print. Compact output is capped lower than full output.",
    default: 8,
  },
  verbosity: {
    type: "string",
    description: "Output size: compact, hints, or full. Use full with --json only when full shapes/routes are needed.",
    default: "compact",
  },
  visibility: {
    type: "string",
    description: "Optional visibility filter: DefaultVisible, EscalationVisible, or ExpertOnly.",
  },
  json: {
    type: "boolean",
    description: "Print operation search results as JSON.",
    default: false,
  },
} as const;

function runOperationSearch(values: {
  query?: string;
  domain?: string;
  intent?: string;
  limit?: number;
  verbosity?: string;
  visibility?: string;
  json?: boolean;
}): void {
  const results = searchHostOperationMatches({
    query: values.query,
    domain: values.domain,
    intent: parseOperationIntent(values.intent),
    limit: values.limit,
    verbosity: parseOperationVerbosity(values.verbosity),
    visibility: parseOperationVisibility(values.visibility),
  });
  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  writeOperationSearchResults(results);
}

const hostOperationsCommand = define({
  name: "operations",
  description: "List generated public Pe.Host operations available to the agent, including layer/domain/cost/result-grain metadata.",
  args: operationSearchArgs,
  examples: [
    "pea host operations",
    "pea host operations --query \"loaded families\"",
    "pea host operations --domain revit --intent Read",
  ].join("\n"),
  run: (ctx) => runOperationSearch(ctx.values),
});

const hostOperationSearchCommand = define({
  name: "search",
  description: "Search generated public Pe.Host operations by user intent and operation metadata.",
  args: operationSearchArgs,
  examples: [
    "pea host operation search --query \"this view\"",
    "pea host operation search --query \"parameter presence\" --json",
  ].join("\n"),
  run: (ctx) => runOperationSearch(ctx.values),
});

const hostOperationCallCommand = define({
  name: "call",
  description: "Call a generated public Pe.Host operation by key with JSON request data.",
  args: {
    host: commonArgs.host,
    key: {
      type: "string",
      description: "Host operation key, such as revit.context.summary, revit.resolve.references, or settings.document.validate.",
    },
    requestJson: {
      type: "string",
      description: "JSON request object. Omit for NoRequest operations.",
    },
    verbosity: {
      type: "string",
      description: "Successful-call metadata size: compact, hints, or full. Failures always include full metadata.",
      default: "compact",
    },
    json: {
      type: "boolean",
      description: "Print the raw call result as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea host operation call --key revit.context.summary --json",
    "pea host operation call --key revit.resolve.references --request-json '{\"referenceText\":\"this view\",\"maxResults\":5}' --json",
  ].join("\n"),
  run: async (ctx) => {
    if (!ctx.values.key)
      throw new Error("Provide --key <operation-key>.");

    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const result = await callHostOperation(
      { baseUrl: hostBaseUrl },
      ctx.values.key,
      parseRequestJson(ctx.values.requestJson),
      parseOperationVerbosity(ctx.values.verbosity),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok)
        process.exitCode = 1;
      return;
    }

    writeOperationCallResult(result);
    if (!result.ok)
      process.exitCode = 1;
  },
});

const hostOperationCommand = define({
  name: "operation",
  description: "Search and call generated public Pe.Host operations.",
  examples: [
    "pea host operation search --query \"schedule fields\"",
    "pea host operation call --key revit.context.summary --json",
  ].join("\n"),
  subCommands: {
    search: hostOperationSearchCommand,
    call: hostOperationCallCommand,
  },
  run: () => {
    console.log("Run `pea host operation --help` to list operation commands.");
  },
});

const hostCommand = define({
  name: "host",
  description: "Inspect Pe.Host state.",
  examples: [
    "pea host status",
    "pea host logs --target revit --tail 50",
    "pea host operations --query \"active document\"",
  ].join("\n"),
  subCommands: {
    status: hostStatusCommand,
    logs: hostLogsCommand,
    operations: hostOperationsCommand,
    operation: hostOperationCommand,
  },
  run: () => {
    console.log("Run `pea host --help` to list host commands.");
  },
});

const scriptExecuteCommand = define({
  name: "execute",
  description: "Execute a C# Revit script through Pe.Host. Inline content may be Execute-body statements or a full PeScriptContainer class. Loose workspaces compile only the requested file; pod.json workspaces compile all src and require a declared entrypoint.",
  args: {
    ...commonArgs,
    file: {
      type: "string",
      description: "Read inline script content from a local file.",
    },
    stdin: {
      type: "boolean",
      description: "Read inline script content from stdin.",
      default: false,
    },
    scriptContent: {
      type: "string",
      description: "Inline script content. Prefer Execute-body statements such as WriteLine(\"...\"); a full PeScriptContainer class is also allowed.",
    },
    sourcePath: {
      type: "string",
      description: "Workspace-relative source path to execute. In loose workspaces only this file compiles; in Pod mode it must be declared in pod.json and all src/**/*.cs compiles.",
    },
    sourceName: {
      type: "string",
      description: "Synthetic source filename used for inline trace files and compile diagnostics.",
      default: "AgentSnippet.cs",
    },
    permissionMode: {
      type: "string",
      description: "Script permission mode: ReadOnly or WriteTransaction. Defaults to ReadOnly.",
      default: ScriptPermissionMode.ReadOnly,
    },
    json: {
      type: "boolean",
      description: "Print the raw execution DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea script execute --file scratch\\Probe.cs",
    "pea script execute --source-path src\\SampleScript.cs",
    "pea script execute --workspace panel-audit --source-path src\\Main.cs",
    "Get-Content .\\Probe.cs | pea script execute --stdin --source-name Probe.cs",
  ].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const scriptContent = await resolveScriptContent({
      file: ctx.values.file,
      stdin: ctx.values.stdin,
      scriptContent: ctx.values.scriptContent,
    });
    const isWorkspacePath = ctx.values.sourcePath != null && ctx.values.sourcePath.trim().length > 0;

    if (!scriptContent && !isWorkspacePath)
      throw new Error("Provide --file, --stdin, --script-content, or --source-path.");

    const result = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.execute({
        workspaceKey: ctx.values.workspace,
        sourceKind: isWorkspacePath
          ? ScriptExecutionSourceKind.WorkspacePath
          : ScriptExecutionSourceKind.InlineSnippet,
        sourcePath: ctx.values.sourcePath,
        scriptContent,
        sourceName: ctx.values.sourceName,
        permissionMode: parseScriptPermissionMode(ctx.values.permissionMode),
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`status    ${result.status}`);
    console.log(`execution ${result.executionId}`);
    console.log(`revit     ${result.revitVersion}`);
    if (result.containerTypeName)
      console.log(`container ${result.containerTypeName}`);
    if (result.output)
      console.log(result.output.trimEnd());
    for (const diagnostic of result.diagnostics)
      console.error(`${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
  },
});

const scriptBootstrapCommand = define({
  name: "bootstrap",
  description: "Create or update a Pe scripting workspace through Pe.Host.",
  args: {
    ...commonArgs,
    noSample: {
      type: "boolean",
      description: "Do not create the sample script file.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print the raw bootstrap DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: ["pea script bootstrap", "pea script bootstrap --workspace default --no-sample"].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const bootstrap = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.bootstrapWorkspace({
        workspaceKey: ctx.values.workspace,
        createSampleScript: !ctx.values.noSample,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(bootstrap, null, 2));
      return;
    }

    console.log(`workspace key ${bootstrap.workspaceKey}`);
    console.log(`product home ${bootstrap.productHomePath}`);
    console.log(`workspace    ${bootstrap.workspaceRootPath}`);
    console.log(`project      ${bootstrap.projectFilePath}`);
    console.log(`sample       ${bootstrap.sampleScriptPath}`);
  },
});

const scriptPodImportCommand = define({
  name: "import",
  description: "Import a pod.json-backed scripting workspace from a Pod zip archive. Fails if the target workspace already exists.",
  args: {
    host: commonArgs.host,
    archive: {
      type: "string",
      description: "Path to the Pod zip archive to import.",
    },
    workspace: {
      type: "string",
      description: "Optional target workspace slug. Omit to use the pod.json id.",
    },
    json: {
      type: "boolean",
      description: "Print the raw import DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea script import --archive .\\panel-audit.zip",
    "pea script import --archive .\\panel-audit.zip --workspace panel-audit-copy",
  ].join("\n"),
  run: async (ctx) => {
    const archivePath = firstNonBlank(ctx.values.archive);
    if (!archivePath)
      throw new Error("Provide --archive <path.zip>.");

    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const result = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.importPod({
        archivePath,
        workspaceKey: firstNonBlank(ctx.values.workspace),
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    writeScriptPodImport(result);
  },
});

const scriptPodExportCommand = define({
  name: "export",
  description: "Export a pod.json-backed scripting workspace as a portable source-first Pod zip archive.",
  args: {
    ...commonArgs,
    output: {
      type: "string",
      description: "Output path for the Pod zip archive.",
    },
    json: {
      type: "boolean",
      description: "Print the raw export DTO as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea script export --workspace panel-audit --output .\\panel-audit.zip",
    "pea script export --output .\\default.zip",
  ].join("\n"),
  run: async (ctx) => {
    const archivePath = firstNonBlank(ctx.values.output);
    if (!archivePath)
      throw new Error("Provide --output <path.zip>.");

    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const result = await callPeHost(
      hostBaseUrl,
      () => createPeHostClient(hostBaseUrl).scripting.exportPod({
        workspaceKey: ctx.values.workspace,
        archivePath,
      }),
    );

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    writeScriptPodExport(result);
  },
});

const scriptCommand = define({
  name: "script",
  description: "Bootstrap, execute, import, and export Pe.Revit scripting workspaces and Pods through Pe.Host.",
  examples: [
    "pea script bootstrap",
    "pea script execute --source-path src\\SampleScript.cs",
    "pea script export --workspace panel-audit --output .\\panel-audit.zip",
    "pea script import --archive .\\panel-audit.zip",
  ].join("\n"),
  subCommands: {
    bootstrap: scriptBootstrapCommand,
    execute: scriptExecuteCommand,
    export: scriptPodExportCommand,
    import: scriptPodImportCommand,
  },
  run: () => {
    console.log("Run `pea script --help` to list script commands.");
  },
});

const liveStatusCommand = define({
  name: "status",
  description: "Print the shared live-loop decision packet for AttachedRrd work.",
  args: {
    host: commonArgs.host,
    logTail: {
      type: "number",
      description: "Number of log lines to include per host/Revit log file.",
      default: 10,
    },
    resetLogCursor: {
      type: "boolean",
      description: "Reset in-process log cursors after reading.",
      default: false,
    },
    noLastSync: {
      type: "boolean",
      description: "Omit the last live_rrd_sync result from the packet.",
      default: false,
    },
    timeoutSeconds: {
      type: "number",
      description: "Timeout budget carried in the decision packet.",
      default: defaultLiveLoopTimeoutSeconds,
    },
    json: {
      type: "boolean",
      description: "Print the raw live-loop packet as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea live status",
    "pea live status --log-tail 50 --json",
  ].join("\n"),
  run: async (ctx) => {
    const status = await collectRuntimeLoopContext({
      hostBaseUrl: ctx.values.host,
      logTail: ctx.values.logTail,
      resetLogCursor: ctx.values.resetLogCursor,
      includeLastSync: !ctx.values.noLastSync,
      timeoutSeconds: ctx.values.timeoutSeconds,
    });

    if (ctx.values.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    writeLiveLoopStatus(status);
  },
});

const liveSyncCommand = define({
  name: "sync",
  description: "Run RiderBridge hot reload for the live Rider-driven RRD session.",
  args: {
    riderBridgeBaseUrl: {
      type: "string",
      description: "Pe.RiderBridge base URL.",
      default: defaultRiderBridgeBaseUrl,
    },
    project: {
      type: "string",
      description: "Rider project name.",
      default: "Pe.Tools",
    },
    timeoutSeconds: {
      type: "number",
      description: "Client-side timeout for the RiderBridge sync.",
      default: defaultLiveLoopTimeoutSeconds,
    },
    json: {
      type: "boolean",
      description: "Print the raw sync result as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea live sync",
    "pea live sync --rider-bridge-base-url http://127.0.0.1:63342",
  ].join("\n"),
  run: async (ctx) => {
    const result = await syncLiveRrd({
      riderBridgeBaseUrl: ctx.values.riderBridgeBaseUrl,
      project: ctx.values.project,
      timeoutSeconds: ctx.values.timeoutSeconds,
    });

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok)
        process.exitCode = 1;
      return;
    }

    writeWorkflowResult(result);
    if (!result.ok)
      process.exitCode = 1;
  },
});

const liveRestartCommand = define({
  name: "restart",
  description: "Start or restart the Rider-driven RRD session through Pe.RiderBridge.",
  args: {
    riderBridgeBaseUrl: {
      type: "string",
      description: "Pe.RiderBridge base URL.",
      default: defaultRiderBridgeBaseUrl,
    },
    project: {
      type: "string",
      description: "Rider project name.",
      default: "Pe.Tools",
    },
    actionId: {
      type: "string",
      description: "Optional Rider action override. Defaults to trying Rerun, then Debug.",
    },
    expectedRevitVersion: {
      type: "string",
      description: "Expected connected Revit year after restart.",
      default: "2025",
    },
    requireNewProcess: {
      type: "boolean",
      description: "Require the connected Revit process id to change after restart.",
      default: true,
    },
    readinessLevel: {
      type: "string",
      description: "Readiness level: BridgeConnected, ModulesLoaded, AnyDocumentOpen, or ActiveDocumentReady.",
      default: "ModulesLoaded",
    },
    openDocumentPath: {
      type: "string",
      description: "Absolute local RVT/RFA path to open after module readiness.",
    },
    openDocumentName: {
      type: "string",
      description: "Recent local Revit document name to resolve and open after module readiness.",
    },
    openDocumentKind: {
      type: "string",
      description: "Open-document kind filter: Project, Family, or Any.",
      default: "Any",
    },
    openDocumentRevitYear: {
      type: "string",
      description: "Revit year used when resolving recent documents by name.",
      default: "2025",
    },
    includeCloudRecentDocuments: {
      type: "boolean",
      description: "Allow cloud recent-document matches during name resolution. Local files are still the only opener target.",
      default: false,
    },
    noOpenDocument: {
      type: "boolean",
      description: "Disable the explicit or harness-state default open-document step.",
      default: false,
    },
    harnessStatePath: {
      type: "string",
      description: "Optional repo-relative or absolute JSON file with revit.defaultOpenDocument.",
    },
    timeoutSeconds: {
      type: "number",
      description: "Client-side timeout for the RiderBridge restart action.",
      default: defaultLiveLoopTimeoutSeconds,
    },
    pollSeconds: {
      type: "number",
      description: "Seconds to poll Pe.Host/Revit bridge readiness after restart.",
      default: 180,
    },
    pollIntervalSeconds: {
      type: "number",
      description: "Seconds between readiness polls.",
      default: 5,
    },
    json: {
      type: "boolean",
      description: "Print the raw restart result as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea live restart",
    "pea live restart --readiness-level ActiveDocumentReady --open-document-name Sample",
  ].join("\n"),
  run: async (ctx) => {
    const result = await restartLiveRrd({
      riderBridgeBaseUrl: ctx.values.riderBridgeBaseUrl,
      project: ctx.values.project,
      actionId: ctx.values.actionId,
      expectedRevitVersion: ctx.values.expectedRevitVersion,
      requireNewProcess: ctx.values.requireNewProcess,
      readinessLevel: parseLiveReadinessLevel(ctx.values.readinessLevel),
      openDocument: resolveOpenDocumentOption(ctx.values),
      harnessStatePath: ctx.values.harnessStatePath,
      timeoutSeconds: ctx.values.timeoutSeconds,
      pollSeconds: ctx.values.pollSeconds,
      pollIntervalSeconds: ctx.values.pollIntervalSeconds,
    });

    if (ctx.values.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok)
        process.exitCode = 1;
      return;
    }

    writeWorkflowResult(result);
    if (!result.ok)
      process.exitCode = 1;
  },
});

const liveCommand = define({
  name: "live",
  description: "Inspect and manage the live Rider/Revit RRD loop.",
  examples: [
    "pea live status",
    "pea live sync",
    "pea live restart",
  ].join("\n"),
  subCommands: {
    status: liveStatusCommand,
    sync: liveSyncCommand,
    restart: liveRestartCommand,
  },
  run: () => {
    console.log("Run `pea live --help` to list live-loop commands.");
  },
});

const runtimePayloadCommand = define({
  name: "payload",
  description: "Print installed pea runtime payload metadata.",
  args: {
    json: {
      type: "boolean",
      description: "Print runtime payload metadata as JSON.",
      default: false,
    },
  },
  run: async (ctx) => {
    const status = await getPeaRuntimeStatus();
    if (ctx.values.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    console.log(`pea root  ${status.peaRoot}`);
    console.log(`active    ${status.activeVersion ?? "none"}`);
    console.log(`version   ${status.activeVersionRoot ?? "none"}`);
    console.log(`manifest  ${status.manifestPath ?? "none"}`);
  },
});

const runtimeUpdateCommand = define({
  name: "update",
  description: "Install and activate a versioned pea payload from a manifest path or URL.",
  args: {
    manifest: {
      type: "string",
      description: "Path or URL to a pea payload manifest.",
    },
  },
  run: async (ctx) => {
    if (!ctx.values.manifest)
      throw new Error("Provide --manifest <path-or-url>.");

    const result = await updatePeaRuntime(ctx.values.manifest);
    console.log(`installed ${result.version}`);
    console.log(`active    ${result.currentVersionPath}`);
  },
});

const runtimeCommand = define({
  name: "runtime",
  description: "Inspect or update the installed pea runtime payload.",
  examples: [
    "pea runtime payload",
    "pea runtime update --manifest .\\Pe.Tools.pea.0.1.0.json",
  ].join("\n"),
  subCommands: {
    payload: runtimePayloadCommand,
    update: runtimeUpdateCommand,
  },
  run: () => {
    console.log("Run `pea runtime --help` to list runtime commands.");
  },
});

const configDefaultsCommand = define({
  name: "defaults",
  description: "Print Pea-owned agent settings path and default model/runtime posture.",
  args: {
    ...commonArgs,
    workspaceRoot: {
      type: "string",
      description: "Explicit product/workbench root. Avoids asking Pe.Host to bootstrap the scripting workspace.",
    },
    write: {
      type: "boolean",
      description: "Seed/update the Pea-owned settings file before printing defaults.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print defaults as JSON.",
      default: false,
    },
  },
  toKebab: true,
  examples: [
    "pea config defaults",
    "pea config defaults --write",
    "pea config defaults --workspace-root C:\\Users\\you\\Documents\\Pe.Tools --json",
  ].join("\n"),
  run: async (ctx) => {
    const hostBaseUrl = resolveHostBaseUrl(ctx.values.host);
    const workspaceKey = resolveWorkspaceKey(ctx.values.workspace);
    const productHomePath = await resolveProductHomeForConfig(
      hostBaseUrl,
      workspaceKey,
      ctx.values.workspaceRoot,
    );
    const summary = ctx.values.write
      ? await ensurePeaRuntimeDefaults(productHomePath)
      : getPeaRuntimeDefaultsSummary(productHomePath);

    if (ctx.values.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    writePeaDefaultsSummary(summary);
  },
});

const configCommand = define({
  name: "config",
  description: "Inspect Pea agent configuration paths and default posture.",
  examples: [
    "pea config defaults",
    "pea config defaults --write --json",
  ].join("\n"),
  subCommands: {
    defaults: configDefaultsCommand,
  },
  run: () => {
    console.log("Run `pea config --help` to list config commands.");
  },
});

const entryCommand = define({
  name: "pea",
  description: "Pea CLI. `pea agent` starts the deployed Revit/operator workbench; `pea dev` starts the repo coding agent.",
  examples: [
    "pea agent",
    "pea dev",
    "pea host status",
    "pea host logs --target revit --tail 50",
    "pea live status",
    "pea runtime payload",
    "pea script bootstrap --workspace default",
    "pea script execute --source-path src\\SampleScript.cs",
    "pea script export --workspace panel-audit --output .\\panel-audit.zip",
  ].join("\n"),
  run: () => {
    console.log("Run `pea --help` to list commands. Use `pea agent` for deployed Pea; use `pea dev` only for Pe.Tools repo coding.");
  },
});

try {
  await cli(normalizeCliArgs(process.argv.slice(2)), entryCommand, {
    name: "pea",
    version: "0.1.0",
    description: `Pea CLI. Pea operator defaults: host=${defaultHostBaseUrl}, workspace=${defaultWorkspaceKey}. dev-agent is repo-only.`,
    subCommands: {
      agent: agentCommand,
      dev: devCommand,
      "dev-agent": devAgentCommand,
      config: configCommand,
      host: hostCommand,
      live: liveCommand,
      runtime: runtimeCommand,
      script: scriptCommand,
    },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

async function resolveProductHomeForConfig(
  hostBaseUrl: string,
  workspaceKey: string,
  workspaceRoot: string | undefined,
): Promise<string> {
  if (workspaceRoot?.trim())
    return resolve(workspaceRoot.trim());

  const bootstrap = await callPeHost(
    hostBaseUrl,
    () => createPeHostClient(hostBaseUrl).scripting.bootstrapWorkspace({
      workspaceKey,
      createSampleScript: false,
    }),
  );
  return bootstrap.productHomePath;
}

function writePeaDefaultsSummary(summary: PeaRuntimeDefaultsSummary): void {
  console.log(`settings  ${summary.settingsPath}`);
  console.log(`pack      ${summary.modelPackId}`);
  console.log(`agent     ${summary.agentModelId}`);
  console.log(`fast      ${summary.fastModelId}`);
  console.log(`observer  ${summary.observerModelId}`);
  console.log(`reflector ${summary.reflectorModelId}`);
  console.log(`goal      judge=${summary.goalJudgeModelId} maxTurns=${summary.goalMaxTurns}`);
  console.log(`om        observe=${summary.observationThreshold} reflect=${summary.reflectionThreshold}`);
  console.log(`ui        theme=${summary.theme} quiet=${summary.quietMode} previewLines=${summary.quietModeMaxToolPreviewLines}`);
  console.log(`runtime   configDir=${summary.policy.configDir} mcpEnabled=${summary.policy.mcpEnabled}`);
  console.log(`cache     promptRequired=${summary.policy.promptCachingRequired} openaiResponsesHistoryCompat=${summary.policy.openAiResponsesHistoryCompatEnabled}`);
}

async function getPeaRuntimeStatus(): Promise<{
  peaRoot: string;
  currentVersionPath: string;
  activeVersion: string | null;
  activeVersionRoot: string | null;
  manifestPath: string | null;
}> {
  const peaRoot = resolvePeaRoot();
  const currentVersionPath = join(peaRoot, peaCliIdentity.currentVersionFileName);
  const activeVersion = await readOptionalText(currentVersionPath);
  const normalizedVersion = activeVersion?.trim() || null;
  const activeVersionRoot = normalizedVersion ? join(peaRoot, peaCliIdentity.versionsDirectoryName, normalizedVersion) : null;
  const manifestPath = activeVersionRoot ? join(activeVersionRoot, peaCliIdentity.payloadManifestFileName) : null;
  return {
    peaRoot,
    currentVersionPath,
    activeVersion: normalizedVersion,
    activeVersionRoot,
    manifestPath,
  };
}

async function updatePeaRuntime(manifestRef: string): Promise<{
  version: string;
  currentVersionPath: string;
}> {
  const peaRoot = resolvePeaRoot();
  const packagesRoot = join(peaRoot, peaCliIdentity.packagesDirectoryName);
  const versionsRoot = join(peaRoot, peaCliIdentity.versionsDirectoryName);
  await mkdir(packagesRoot, { recursive: true });
  await mkdir(versionsRoot, { recursive: true });

  const manifest = await readPayloadManifest(manifestRef);
  validatePayloadManifest(manifest);
  const archivePath = join(packagesRoot, manifest.archiveFileName);
  await stageArchive(manifestRef, manifest, archivePath);
  const actualSha256 = await computeSha256(archivePath);
  if (actualSha256.toLowerCase() !== manifest.sha256.toLowerCase())
    throw new Error(`Payload hash mismatch. Expected ${manifest.sha256}; actual ${actualSha256}.`);

  const versionRoot = join(versionsRoot, manifest.version);
  const tempRoot = `${versionRoot}.tmp-${process.pid}`;
  await rm(tempRoot, { recursive: true, force: true });
  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  await extractZip(archivePath, tempRoot);
  await writeFile(join(tempRoot, peaCliIdentity.payloadManifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  await rename(tempRoot, versionRoot);

  const currentVersionPath = join(peaRoot, peaCliIdentity.currentVersionFileName);
  const tempCurrentPath = `${currentVersionPath}.tmp`;
  await writeFile(tempCurrentPath, manifest.version, "utf-8");
  await rename(tempCurrentPath, currentVersionPath);

  return { version: manifest.version, currentVersionPath };
}

function resolvePeaRoot(): string {
  const mainPath = fileURLToPath(import.meta.url);
  const distRoot = dirname(mainPath);
  const versionRoot = dirname(distRoot);
  const versionsRoot = dirname(versionRoot);
  return dirname(versionsRoot);
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function readPayloadManifest(manifestRef: string): Promise<PeaPayloadManifest> {
  const text = isUrl(manifestRef)
    ? await fetchText(manifestRef)
    : await readFile(resolve(manifestRef), "utf-8");
  return JSON.parse(text) as PeaPayloadManifest;
}

function validatePayloadManifest(manifest: PeaPayloadManifest): void {
  if (manifest.schemaVersion !== peaCliIdentity.payloadManifestSchemaVersion)
    throw new Error(`Unsupported pea payload manifest schema ${manifest.schemaVersion}.`);
  if (manifest.productName !== productIdentity.productName)
    throw new Error(`Unsupported product '${manifest.productName}'.`);
  if (manifest.payloadName !== peaCliIdentity.directoryName)
    throw new Error(`Unsupported payload '${manifest.payloadName}'.`);
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(manifest.version))
    throw new Error(`Invalid payload version '${manifest.version}'.`);
  if (!/^[0-9a-f]{64}$/i.test(manifest.sha256))
    throw new Error("Payload manifest sha256 must be a 64-character hex string.");
}

async function stageArchive(
  manifestRef: string,
  manifest: PeaPayloadManifest,
  archivePath: string,
): Promise<void> {
  const archiveRef = isUrl(manifestRef)
    ? new URL(manifest.archiveFileName, manifestRef).toString()
    : resolve(dirname(resolve(manifestRef)), manifest.archiveFileName);
  if (isUrl(archiveRef)) {
    await downloadFile(archiveRef, archivePath);
    return;
  }

  const sourcePath = isAbsolute(archiveRef) ? archiveRef : resolve(archiveRef);
  await stat(sourcePath);
  await rm(archivePath, { force: true });
  await copyFile(sourcePath, archivePath);
}

async function computeSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function extractZip(archivePath: string, targetDirectory: string): Promise<void> {
  await runProcess("tar", ["-xf", archivePath, "-C", targetDirectory]);
}

async function runProcess(fileName: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(fileName, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0)
        resolvePromise();
      else
        reject(new Error(`${fileName} exited with code ${code}.`));
    });
  });
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

async function downloadFile(url: string, path: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
}

async function resolveScriptContent(options: {
  file?: string;
  stdin?: boolean;
  scriptContent?: string;
}): Promise<string | undefined> {
  const sources = [options.file, options.stdin ? "stdin" : undefined, options.scriptContent]
    .filter((value) => value != null && String(value).trim().length > 0);
  if (sources.length > 1)
    throw new Error("Provide only one of --file, --stdin, or --script-content.");

  if (options.file)
    return readFile(options.file, "utf-8");
  if (options.stdin)
    return readStdin();
  return options.scriptContent;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

async function getHostStatus(hostBaseUrl: string): Promise<PeHostStatusSnapshot> {
  return callPeHost(hostBaseUrl, async () => {
    const client = createPeHostClient(hostBaseUrl);
    const [probe, sessionSummary] = await Promise.all([
      client.host.getProbe(),
      client.host.getSessionSummary(),
    ]);
    return { probe, sessionSummary };
  });
}

function parseOperationIntent(value: string | undefined): "Read" | "Mutate" | undefined {
  if (!value)
    return undefined;

  switch (value.toLowerCase()) {
    case "read":
      return "Read";
    case "mutate":
    case "write":
      return "Mutate";
    default:
      throw new Error("Unknown operation intent. Expected Read or Mutate.");
  }
}

function parsePeaAuthSource(value: string | undefined): PeaAuthSource {
  if (!value)
    return "api-key";

  switch (value.toLowerCase()) {
    case "auto":
      return "auto";
    case "api-key":
    case "apikey":
    case "key":
      return "api-key";
    case "oauth":
      return "oauth";
    default:
      throw new Error("Unknown auth source. Expected auto, api-key, or oauth.");
  }
}

function parseOperationVisibility(value: string | undefined): "DefaultVisible" | "EscalationVisible" | "ExpertOnly" | undefined {
  if (!value)
    return undefined;

  switch (value.toLowerCase()) {
    case "defaultvisible":
    case "default":
      return "DefaultVisible";
    case "escalationvisible":
    case "escalation":
      return "EscalationVisible";
    case "expertonly":
    case "expert":
      return "ExpertOnly";
    default:
      throw new Error("Unknown operation visibility. Expected DefaultVisible, EscalationVisible, or ExpertOnly.");
  }
}

function parseOperationVerbosity(value: string | undefined): "compact" | "hints" | "full" {
  if (!value)
    return "compact";

  switch (value.toLowerCase()) {
    case "compact":
      return "compact";
    case "hints":
      return "hints";
    case "full":
      return "full";
    default:
      throw new Error("Unknown operation verbosity. Expected compact, hints, or full.");
  }
}

function parseRequestJson(value: string | undefined): unknown {
  if (!value || value.trim().length === 0)
    return undefined;

  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --request-json value: ${detail}`);
  }
}

function parseLogTarget(value: string): HostLogTarget {
  switch (value.toLowerCase()) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
    case "app":
      return HostLogTarget.Revit;
    case "all":
    case "both":
      return HostLogTarget.All;
    default:
      throw new Error("Unknown log target. Expected host, revit, or all.");
  }
}

function parseScriptPermissionMode(value: string): ScriptPermissionMode {
  switch (value.toLowerCase()) {
    case "readonly":
    case "read-only":
    case "read_only":
      return ScriptPermissionMode.ReadOnly;
    case "writetransaction":
    case "write-transaction":
    case "write_transaction":
      return ScriptPermissionMode.WriteTransaction;
    default:
      throw new Error("Unknown script permission mode. Expected ReadOnly or WriteTransaction.");
  }
}

async function callPeHost<T>(hostBaseUrl: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof PeHostClientError)) {
      try {
        await ensurePeHostRunning(hostBaseUrl);
        return await action();
      } catch (retryError) {
        throw new Error(formatPeHostError(hostBaseUrl, retryError));
      }
    }

    throw new Error(formatPeHostError(hostBaseUrl, error));
  }
}

async function ensurePeHostRunning(hostBaseUrl: string): Promise<void> {
  try {
    await createPeHostClient(hostBaseUrl).host.getProbe();
    return;
  } catch (error) {
    if (error instanceof PeHostClientError)
      return;
  }

  const hostExecutablePath = await resolveHostExecutablePath();
  if (!hostExecutablePath)
    return;

  const child = spawn(hostExecutablePath, [], {
    cwd: dirname(hostExecutablePath),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 8000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await delay(250);
    try {
      await createPeHostClient(hostBaseUrl).host.getProbe();
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof PeHostClientError)
        return;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`Started Pe.Host from ${hostExecutablePath}, but it did not become reachable at ${hostBaseUrl} within 8 seconds. Last probe error: ${detail}`);
}

async function resolveHostExecutablePath(): Promise<string | null> {
  const candidates = [
    process.env[hostProcessIdentity.hostExecutablePathVariable],
    join(dirname(resolvePeaRoot()), hostProcessIdentity.directoryName, hostProcessIdentity.executableName),
  ].filter((value): value is string => value != null && value.trim().length > 0);

  for (const candidate of candidates) {
    try {
      const resolved = resolve(candidate);
      const fileStat = await stat(resolved);
      if (fileStat.isFile())
        return resolved;
    } catch {
    }
  }

  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function formatPeHostError(hostBaseUrl: string, error: unknown): string {
  if (error instanceof PeHostClientError) {
    if (error.status === 503)
      return [
        `Pe.Host is reachable at ${hostBaseUrl}, but Revit is not ready for this request.`,
        error.message,
        "Open Revit, connect the bridge, then retry.",
      ].filter(Boolean).join("\n");

    return `Pe.Host request failed at ${hostBaseUrl}: ${error.message}`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return [
    `Pe.Host is not reachable at ${hostBaseUrl}.`,
    detail,
    "Check the Pe.Host install path, host logs, or pass --host <url>.",
  ].join("\n");
}

function writeOperationSearchResults(results: ReturnType<typeof searchHostOperationMatches>): void {
  if (results.length === 0) {
    console.log("No host operations matched.");
    return;
  }

  for (const result of results) {
    console.log(`${result.key}`);
    console.log(`  ${result.description}`);
    console.log(`  safety=${result.safety || "-"}`);
    console.log(`  visibility=${result.visibility ?? "-"}`);
    console.log(`  request=${result.requestTypeName} response=${result.responseTypeName}`);
    console.log(`  hint ${result.requestHint}`);
    if (result.safeDefaultRequestJson)
      console.log(`  safe-default ${compactJsonLiteral(result.safeDefaultRequestJson)}`);
    if (result.bestRequestExample) {
      console.log(`  example ${result.bestRequestExample.name}: ${result.bestRequestExample.description}`);
      console.log(`  json ${compactJsonLiteral(result.bestRequestExample.json)}`);
    }
    if ("executionMode" in result)
      console.log(`  mode=${result.executionMode}${result.singleFlightGroup ? ` single-flight=${result.singleFlightGroup}` : ""}`);
    if ("verb" in result)
      console.log(`  route=${result.verb} ${result.route}`);
    if ("callGuidance" in result) {
      for (const hint of result.callGuidance)
        console.log(`  guidance ${hint}`);
      for (const related of result.relatedOperations ?? [])
        console.log(`  related ${related.kind}:${related.key}${related.note ? ` ${related.note}` : ""}`);
    }
  }
}

function compactJsonLiteral(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.replace(/\s+/g, " ").trim();
  }
}

function writeOperationCallResult(result: HostOperationCallResult): void {
  console.log(`${result.key} ${result.ok ? "ok" : "failed"}`);
  if (!result.ok) {
    console.error(result.status ? `status ${result.status}: ${result.message}` : result.message);
    if (result.problem)
      console.error(JSON.stringify(result.problem, null, 2));
    if (result.bestRequestExample) {
      console.error(`example ${result.bestRequestExample.name}: ${result.bestRequestExample.description}`);
      console.error(`json ${compactJsonLiteral(result.bestRequestExample.json)}`);
    }
    for (const step of result.nextSteps)
      console.error(`next ${step}`);
    return;
  }

  if (result.operation)
    console.log(`operation ${result.operation.description}`);
  console.log(JSON.stringify(result.response, null, 2));
}

type LiveLoopStatus = Awaited<ReturnType<typeof collectRuntimeLoopContext>>;

interface CliWorkflowResult {
  ok: boolean;
  workflow: string;
  policy: string;
  commandLine?: string | null;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  guidance?: string;
  runtimeFreshness?: {
    verdict?: string;
    loadedGraphVerdict?: string;
    sourceDeltaVerdict?: string;
  };
  proof?: {
    interpretation?: string;
    proves?: string;
    doesNotProve?: string;
    nextStep?: string | null;
  };
}

function writeLiveLoopStatus(status: LiveLoopStatus): void {
  const host = status.environment.host;
  const probe: Record<string, unknown> = isRecord(host?.probe) ? host.probe : {};
  const session: Record<string, unknown> = isRecord(host?.session) ? host.session : {};
  const recommendation = status.recommendation;

  console.log(`checked   ${status.checkedAt}`);
  console.log(`host url  ${status.environment.hostBaseUrl}`);
  console.log(`host      ${host?.reachable ? "reachable" : "unreachable"}`);
  console.log(`bridge    ${formatConnected(probe.bridgeIsConnected)}`);
  if (typeof probe.disconnectReason === "string" && probe.disconnectReason.length > 0)
    console.log(`reason    ${probe.disconnectReason}`);
  if (typeof session.sessionId === "string")
    console.log(`session   ${session.sessionId}`);
  if (typeof session.processId === "number")
    console.log(`process   ${session.processId}`);
  if (typeof session.revitVersion === "string")
    console.log(`revit     ${session.revitVersion}`);
  if (typeof session.openDocumentCount === "number")
    console.log(`open docs ${session.openDocumentCount}`);
  if (typeof session.availableModuleCount === "number")
    console.log(`modules   ${session.availableModuleCount}`);

  const activeDocument = isRecord(session.activeDocument)
    ? session.activeDocument.title
    : session.activeDocument === null
      ? "none"
      : undefined;
  if (typeof activeDocument === "string")
    console.log(`document  ${activeDocument}`);

  if (status.lastSync) {
    console.log(`sync      ${status.lastSync.ok ? "ok" : "failed"} verdict=${status.lastSync.verdict} lane=${status.lastSync.lane}`);
    console.log(`freshness loaded=${status.lastSync.loadedGraphVerdict} source=${status.lastSync.sourceDeltaVerdict}`);
  } else {
    console.log("sync      none");
  }

  if (!status.logs.ok && "error" in status.logs)
    console.log(`logs      error: ${status.logs.error}`);
  for (const log of status.logs.logs)
    console.log(`log       ${log.label} lines=${log.lineCount} new=${log.cursor.newLineCountSinceLastCheck} path=${log.path}`);

  console.log(`lane      ${recommendation.lane}`);
  console.log(`next      ${recommendation.nextAction} (${recommendation.confidence})`);
  console.log(`reason    ${recommendation.reason}`);
}

function writeWorkflowResult(result: CliWorkflowResult): void {
  console.log(`${result.workflow} ${result.ok ? "ok" : "failed"}`);
  console.log(`policy    ${result.policy}`);
  if (result.commandLine)
    console.log(`command   ${result.commandLine}`);
  if (typeof result.exitCode === "number" || result.exitCode === null)
    console.log(`exit      ${result.exitCode ?? "none"}`);
  if (typeof result.timedOut === "boolean")
    console.log(`timed out ${result.timedOut}`);
  if (typeof result.durationMs === "number")
    console.log(`duration  ${result.durationMs}ms`);
  if (result.runtimeFreshness)
    console.log(`freshness verdict=${result.runtimeFreshness.verdict ?? "unknown"} loaded=${result.runtimeFreshness.loadedGraphVerdict ?? "unknown"} source=${result.runtimeFreshness.sourceDeltaVerdict ?? "unknown"}`);
  if (result.guidance)
    console.log(`guidance  ${result.guidance}`);
  if (result.proof?.interpretation)
    console.log(`proof     ${result.proof.interpretation}`);
  if (result.proof?.proves)
    console.log(`proves    ${result.proof.proves}`);
  if (result.proof?.doesNotProve)
    console.log(`limits    ${result.proof.doesNotProve}`);
  if (result.proof?.nextStep)
    console.log(`next step ${result.proof.nextStep}`);
  if (result.stdoutTail?.trim())
    console.log(result.stdoutTail.trimEnd());
  if (result.stderrTail?.trim())
    console.error(result.stderrTail.trimEnd());
}

function writeScriptPodImport(result: ScriptPodImportData): void {
  console.log(`workspace key ${result.workspaceKey}`);
  console.log(`workspace    ${result.workspaceRootPath}`);
  console.log(`archive      ${result.archivePath}`);
  console.log(`manifest     ${result.manifest.id} (${result.manifest.name})`);
  console.log(`entrypoints  ${result.manifest.entrypoints.length}`);
  console.log(`entries      ${result.archiveEntries.length}`);
  console.log(`generated    ${result.generatedFiles.length}`);
  writeScriptDiagnostics(result.diagnostics);
}

function writeScriptPodExport(result: ScriptPodExportData): void {
  console.log(`workspace key ${result.workspaceKey}`);
  console.log(`workspace    ${result.workspaceRootPath}`);
  console.log(`archive      ${result.archivePath}`);
  console.log(`manifest     ${result.manifest.id} (${result.manifest.name})`);
  console.log(`entrypoints  ${result.manifest.entrypoints.length}`);
  console.log(`entries      ${result.archiveEntries.length}`);
  writeScriptDiagnostics(result.diagnostics);
}

function writeScriptDiagnostics(diagnostics: ScriptDiagnostic[]): void {
  for (const diagnostic of diagnostics)
    console.error(`${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
}

function parseLiveReadinessLevel(value: string | undefined): LiveRrdRestartReadinessLevel {
  const normalized = normalizeOption(value ?? "ModulesLoaded");
  switch (normalized) {
    case "bridgeconnected":
      return "BridgeConnected";
    case "modulesloaded":
      return "ModulesLoaded";
    case "anydocumentopen":
      return "AnyDocumentOpen";
    case "activedocumentready":
      return "ActiveDocumentReady";
    default:
      throw new Error("Unknown readiness level. Expected BridgeConnected, ModulesLoaded, AnyDocumentOpen, or ActiveDocumentReady.");
  }
}

function resolveOpenDocumentOption(values: {
  noOpenDocument?: boolean;
  openDocumentPath?: string;
  openDocumentName?: string;
  openDocumentKind?: string;
  openDocumentRevitYear?: string;
  includeCloudRecentDocuments?: boolean;
}): LiveRrdOpenDocumentSelector | null | undefined {
  if (values.noOpenDocument)
    return null;

  const path = firstNonBlank(values.openDocumentPath);
  const name = firstNonBlank(values.openDocumentName);
  if (!path && !name)
    return undefined;

  return {
    path,
    name,
    kind: parseOpenDocumentKind(values.openDocumentKind),
    revitYear: firstNonBlank(values.openDocumentRevitYear) ?? "2025",
    localFilesOnly: !(values.includeCloudRecentDocuments ?? false),
  };
}

function parseOpenDocumentKind(value: string | undefined): "Project" | "Family" | "Any" {
  const normalized = normalizeOption(value ?? "Any");
  switch (normalized) {
    case "project":
      return "Project";
    case "family":
      return "Family";
    case "any":
      return "Any";
    default:
      throw new Error("Unknown open document kind. Expected Project, Family, or Any.");
  }
}

function normalizeOption(value: string): string {
  return value.replace(/[-_\s]/g, "").toLowerCase();
}

function formatConnected(value: unknown): string {
  if (typeof value !== "boolean")
    return "unknown";

  return value ? "connected" : "disconnected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}

function normalizeCliArgs(args: string[]): string[] {
  const separatorIndex = args.indexOf("--");
  if (separatorIndex < 0) return args;

  return [
    ...args.slice(0, separatorIndex),
    ...args.slice(separatorIndex + 1),
  ];
}

function writeLogs(logs: HostLogsData): void {
  for (const file of logs.files) {
    console.log(`== ${file.label} log ==`);
    console.log(file.filePath);
    if (file.lines.length === 0)
      console.log("(empty)");
    else
      console.log(file.lines.join("\n"));
    console.log();
  }
}

function writeStatus(status: PeHostStatusSnapshot): void {
  console.log(`host      reachable`);
  console.log(`bridge    ${status.probe.bridgeIsConnected ? "connected" : "disconnected"}`);
  console.log(`transport ${status.probe.bridgePath}`);
  console.log(`contract  host=${status.probe.hostContractVersion} bridge=${status.probe.bridgeContractVersion}`);

  if (status.probe.disconnectReason)
    console.log(`reason    ${status.probe.disconnectReason}`);

  if (status.sessionSummary.bridgeIsConnected) {
    console.log(`session   ${status.sessionSummary.sessionId ?? "unknown"}`);
    console.log(`process   ${status.sessionSummary.processId ?? "unknown"}`);
    console.log(`revit     ${status.sessionSummary.revitVersion ?? "unknown"}`);
    console.log(`runtime   ${status.sessionSummary.runtimeFramework ?? "unknown"}`);
    console.log(`document  ${status.sessionSummary.activeDocument?.title ?? "none"}`);
    console.log(`open docs ${status.sessionSummary.openDocumentCount}`);
    console.log(`modules   ${status.sessionSummary.availableModules.length}`);
  }

  const parameterResources = status.sessionSummary.workbenchResources.parameters;
  console.log(`param dir ${parameterResources.globalStateDirectoryPath}`);
  console.log(`param res ${parameterResources.parameterServiceCacheFiles.map((file) => `${file.label}:${file.exists ? `${file.sizeBytes}b@${file.lastWriteTimeUnixMs}` : "missing"}`).join(" ")}`);
  console.log(`shared   ${parameterResources.sharedParametersFile.path ? `${parameterResources.sharedParametersFile.path} ${parameterResources.sharedParametersFile.exists ? `${parameterResources.sharedParametersFile.sizeBytes}b@${parameterResources.sharedParametersFile.lastWriteTimeUnixMs}` : "missing"}` : parameterResources.sharedParametersFile.note}`);
}
