import { define } from "gunshi";
import { HostLogTarget, type HostOpResponse } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import {
  ScriptingTools,
  parseCliPermissionMode,
  resolveCliScriptContent,
  scriptClientTimeoutMs,
} from "../shared/scripting.ts";
import type { ScriptExecuteInput } from "../shared/scripting.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { asOptionalString, firstNonBlank } from "../shared/cli-values.ts";

export interface PeaCliCommandOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
}

export class PeaCliCommands {
  constructor(private readonly options: PeaCliCommandOptions = {}) {}

  commands() {
    return {
      host: this.hostCommand(),
      script: this.scriptCommand(),
    };
  }

  hostCommand() {
    return define({
      name: "host",
      description: "Inspect host status, logs, and generated operation contracts.",
      examples: [
        "pea host status",
        "pea host logs --target revit --tail 50",
        "pea host operations search --query schedules",
        "pea host operations call --key revit.context.summary --request {}",
      ].join("\n"),
      subCommands: {
        status: this.hostStatusCommand(),
        logs: this.hostLogsCommand(),
        operations: this.hostOperationsCommand(),
      },
      run: () => {
        console.log("Run `pea host --help` to list host commands.");
      },
    });
  }

  scriptCommand() {
    return define({
      name: "script",
      description:
        "Bootstrap, execute, import, and export Pe.Revit scripting workspaces and Pods through the host.",
      examples: [
        "pea script bootstrap",
        "pea script list",
        "pea script execute --source-path src\\SampleScript.cs",
        "pea script cancel",
        "pea script export --workspace panel-audit --output .\\panel-audit.zip",
        "pea script import --archive .\\panel-audit.zip",
      ].join("\n"),
      subCommands: {
        bootstrap: this.scriptBootstrapCommand(),
        list: this.scriptPodListCommand(),
        execute: this.scriptExecuteCommand(),
        cancel: this.scriptCancelCommand(),
        export: this.scriptPodExportCommand(),
        import: this.scriptPodImportCommand(),
      },
      run: () => {
        console.log("Run `pea script --help` to list script commands.");
      },
    });
  }

  private hostStatusCommand() {
    return define({
      name: "status",
      description: "Print host and Revit session status.",
      args: {
        host: commonArgs.host,
        bridgeSessionId: commonArgs.bridgeSessionId,
      },
      run: async (ctx) => {
        const client = this.createHostRpcCaller(ctx.values);
        const probe = await client.call("host.status");
        const session = await client.call("bridge.sessions.summary");
        writeHostStatus(session, probe);
      },
    });
  }

  private hostLogsCommand() {
    return define({
      name: "logs",
      description: "Print host/Revit log tails.",
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
      },
      examples: ["pea host logs", "pea host logs --target revit --tail 50"].join("\n"),
      run: async (ctx) => {
        const logs = await this.createHostRpcCaller(ctx.values).call("logs.tail", {
          target: parseLogTarget(ctx.values.target),
          tailLineCount: ctx.values.tail,
        });
        writeLogs(logs);
      },
    });
  }

  private hostOperationsCommand() {
    return define({
      name: "operations",
      description: "Search and call generated public host operations.",
      subCommands: {
        search: this.hostOperationSearchCommand(),
        call: this.hostOperationCallCommand(),
      },
      run: () => {
        console.log("Run `pea host operations --help` to list operation commands.");
      },
    });
  }

  private hostOperationSearchCommand() {
    return define({
      name: "search",
      description: "Search generated public host operations by capability and filters.",
      args: {
        query: { type: "string", description: "Optional search query." },
        domain: { type: "string", description: "Optional top-level domain filter." },
        intent: { type: "string", description: "Optional intent filter: Read or Mutate." },
        limit: { type: "number", description: "Maximum operations to print.", default: 8 },
        verbosity: {
          type: "string",
          description: "Output size: compact, hints, or full.",
          default: "compact",
        },
      },
      run: async (ctx) => {
        const results = await new HostRpcCaller().searchOperations({
          query: firstNonBlank(ctx.values.query),
          domain: firstNonBlank(ctx.values.domain),
          intent: parseOperationIntent(ctx.values.intent),
          limit: ctx.values.limit,
          verbosity: parseOperationVerbosity(ctx.values.verbosity),
        });
        if (!Array.isArray(results)) {
          console.log(results.rendered ?? JSON.stringify(results, null, 2));
          return;
        }
        for (const result of results) {
          console.log(`${result.key}  ${result.displayName}`);
          console.log(`  ${result.description}`);
          console.log(`  ${result.requestHint}`);
        }
      },
    });
  }

  private hostOperationCallCommand() {
    return define({
      name: "call",
      description: "Call a generated public host operation by key with an optional JSON request.",
      args: {
        host: commonArgs.host,
        bridgeSessionId: commonArgs.bridgeSessionId,
        key: { type: "string", description: "Operation key returned by host operations search." },
        request: {
          type: "string",
          description: "JSON request object. Omit for NoRequest operations.",
        },
        verbosity: {
          type: "string",
          description: "Output size: compact, hints, or full.",
          default: "compact",
        },
      },
      run: async (ctx) => {
        const key = firstNonBlank(ctx.values.key);
        if (!key) throw new Error("Provide --key <operation.key>.");
        const request = parseOptionalJson(ctx.values.request);
        const result = await this.createHostRpcCaller(ctx.values).callOperation(
          key,
          request,
          parseOperationVerbosity(ctx.values.verbosity),
        );
        console.log(JSON.stringify(result, null, 2));
      },
    });
  }

  private scriptExecuteCommand() {
    return define({
      name: "execute",
      description:
        "Execute a C# Revit script through the host from inline content, stdin, a file, or a declared pod entrypoint. ReadOnly by default: document changes are rolled back and discarded.",
      args: {
        ...commonArgs,
        file: { type: "string", description: "Read inline script content from a local file." },
        stdin: {
          type: "boolean",
          description: "Read inline script content from stdin.",
          default: false,
        },
        scriptContent: { type: "string", description: "Inline script content." },
        sourcePath: {
          type: "string",
          description: "Workspace-relative pod entrypoint path to execute (declared in pod.json).",
        },
        sourceName: {
          type: "string",
          description: "Synthetic source filename used for diagnostics.",
        },
        permissionMode: {
          type: "string",
          description:
            "Script permission mode: ReadOnly (default; changes discarded) or WriteTransaction (changes kept).",
        },
        timeoutSeconds: {
          type: "number",
          description: "Cooperative execution timeout in seconds (host default 600).",
        },
      },
      toKebab: true,
      examples: [
        "pea script execute --file scratch\\Probe.cs",
        "pea script execute --source-path src\\SampleScript.cs",
        "pea script execute --source-path src\\Fix.cs --permission-mode WriteTransaction",
        "Get-Content .\\Probe.cs | pea script execute --stdin --source-name Probe.cs",
      ].join("\n"),
      run: async (ctx) => {
        const scriptContent = await resolveCliScriptContent(ctx.values);
        const sourcePath = firstNonBlank(ctx.values.sourcePath);
        if (!scriptContent && !sourcePath)
          throw new Error("Provide --file, --stdin, --script-content, or --source-path.");
        if (scriptContent && sourcePath)
          throw new Error(
            "Provide inline content (--file/--stdin/--script-content) or --source-path, not both.",
          );

        const timeoutSeconds = asOptionalNumber(ctx.values.timeoutSeconds);
        const result = await this.createScriptingTools(ctx.values, timeoutSeconds).execute({
          scriptContent,
          sourcePath,
          workspaceKey: ctx.values.workspace,
          sourceName: firstNonBlank(ctx.values.sourceName),
          permissionMode: parseCliPermissionMode(ctx.values.permissionMode),
          timeoutSeconds,
        } satisfies ScriptExecuteInput);
        writeScriptExecution(result);
      },
    });
  }

  private scriptCancelCommand() {
    return define({
      name: "cancel",
      description:
        "Signal cooperative cancellation to the currently running script execution. The script stops at its next ct / ThrowIfCancelled checkpoint.",
      args: {
        host: commonArgs.host,
        bridgeSessionId: commonArgs.bridgeSessionId,
        executionId: {
          type: "string",
          description: "Optional execution id guard; omit to cancel the current execution.",
        },
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await this.createScriptingTools(ctx.values).cancel({
          executionId: firstNonBlank(ctx.values.executionId),
        });
        console.log(`canceled  ${result.canceled}`);
        if (result.executionId) console.log(`execution ${result.executionId}`);
        console.log(result.message);
      },
    });
  }

  private scriptPodListCommand() {
    return define({
      name: "list",
      description:
        "List scripting workspaces (pods) with their validated entrypoints. Invalid pods appear with diagnostics explaining what to fix.",
      args: {
        host: commonArgs.host,
        bridgeSessionId: commonArgs.bridgeSessionId,
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await this.createScriptingTools(ctx.values).listPods();
        writeScriptPodList(result);
      },
    });
  }

  private scriptBootstrapCommand() {
    return define({
      name: "bootstrap",
      description:
        "Create or update a Pe scripting pod workspace through the host: pod.json, project file, docs, and a sample entrypoint.",
      args: {
        ...commonArgs,
      },
      toKebab: true,
      examples: ["pea script bootstrap", "pea script bootstrap --workspace panel-audit"].join("\n"),
      run: async (ctx) => {
        const result = await this.createScriptingTools(ctx.values).bootstrap({
          workspaceKey: ctx.values.workspace,
        });
        writeScriptBootstrap(result);
      },
    });
  }

  private scriptPodImportCommand() {
    return define({
      name: "import",
      description: "Import a pod.json-backed scripting workspace from a Pod zip archive.",
      args: {
        host: commonArgs.host,
        bridgeSessionId: commonArgs.bridgeSessionId,
        archive: { type: "string", description: "Path to the Pod zip archive to import." },
        workspace: {
          type: "string",
          description: "Optional target workspace slug. Omit to use the pod.json id.",
        },
      },
      toKebab: true,
      run: async (ctx) => {
        const archivePath = firstNonBlank(ctx.values.archive);
        if (!archivePath) throw new Error("Provide --archive <path.zip>.");
        const result = await this.createScriptingTools(ctx.values).importPod({
          archivePath,
          workspaceKey: firstNonBlank(ctx.values.workspace),
        });
        writeScriptPodImport(result);
      },
    });
  }

  private scriptPodExportCommand() {
    return define({
      name: "export",
      description: "Export a pod.json-backed scripting workspace as a portable Pod zip archive.",
      args: {
        ...commonArgs,
        output: { type: "string", description: "Output path for the Pod zip archive." },
      },
      toKebab: true,
      run: async (ctx) => {
        const archivePath = firstNonBlank(ctx.values.output);
        if (!archivePath) throw new Error("Provide --output <path.zip>.");
        const result = await this.createScriptingTools(ctx.values).exportPod({
          workspaceKey: ctx.values.workspace,
          archivePath,
        });
        writeScriptPodExport(result);
      },
    });
  }

  private createScriptingTools(
    values: Record<string, unknown>,
    scriptTimeoutSeconds?: number,
  ): ScriptingTools {
    return new ScriptingTools(this.createHostRpcCaller(values, scriptTimeoutSeconds), {
      workspaceKey: this.resolveWorkspaceKey(values.workspace),
    });
  }

  private createHostRpcCaller(
    values: Record<string, unknown>,
    scriptTimeoutSeconds?: number,
  ): HostRpcCaller {
    return new HostRpcCaller({
      hostBaseUrl: this.resolveHostBaseUrl(values.host),
      bridgeSessionId: asOptionalString(values.bridgeSessionId),
      ...(scriptTimeoutSeconds != null
        ? { timeoutMs: scriptClientTimeoutMs(scriptTimeoutSeconds) }
        : {}),
    });
  }

  private resolveHostBaseUrl(value?: unknown): string {
    return resolveHostBaseUrl(asOptionalString(value) ?? this.options.hostBaseUrl);
  }

  private resolveWorkspaceKey(value?: unknown): string {
    return resolveWorkspaceKey(asOptionalString(value) ?? this.options.workspaceKey);
  }
}

const commonArgs = {
  host: {
    type: "string",
    description: "Host base URL.",
    default: resolveHostBaseUrl(),
  },
  bridgeSessionId: {
    type: "string",
    description: "Optional TS host bridge session id.",
  },
  workspace: {
    type: "string",
    short: "w",
    description: "Pe scripting workspace or Pod name.",
    default: resolveWorkspaceKey(),
  },
} as const;

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function writeHostStatus(
  session: HostOpResponse<"bridge.sessions.summary">,
  probe: HostOpResponse<"host.status">,
) {
  console.log(`host      ${probe.runtimeIdentity}`);
  console.log(`bridge    ${probe.bridgeIsConnected ? "connected" : "disconnected"}`);
  console.log(`session   ${session.sessionId ?? "none"}`);
  console.log(`revit     ${session.revitVersion ?? "unknown"}`);
  console.log(`documents ${session.openDocumentCount}`);
  if (session.activeDocument) console.log(`active    ${session.activeDocument.title}`);
}

function writeLogs(logs: HostOpResponse<"logs.tail">) {
  for (const file of logs.files) {
    console.log(`== ${file.label} ==`);
    console.log(file.filePath);
    if (file.lines.length) console.log(file.lines.join("\n"));
  }
}

function writeScriptExecution(result: HostOpResponse<"scripting.execute">) {
  console.log(`status    ${result.status}`);
  console.log(`execution ${result.executionId}`);
  console.log(`revit     ${result.revitVersion}`);
  if (result.containerTypeName) console.log(`container ${result.containerTypeName}`);
  if (result.output) console.log(result.output.trimEnd());
  if (result.data !== undefined && result.data !== null)
    console.log(`data      ${JSON.stringify(result.data, null, 2)}`);
  for (const diagnostic of result.diagnostics ?? [])
    console.error(`${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
}

function writeScriptBootstrap(result: HostOpResponse<"scripting.workspace.bootstrap">) {
  console.log(`workspace key ${result.workspaceKey}`);
  console.log(`product home ${result.productHomePath}`);
  console.log(`workspace    ${result.workspaceRootPath}`);
  console.log(`project      ${result.projectFilePath}`);
  console.log(`pod          ${result.podManifestPath}`);
  console.log(`sample       ${result.sampleScriptPath}`);
}

function writeScriptPodList(result: HostOpResponse<"scripting.pod.list">) {
  console.log(`workspaces ${result.workspacesRootPath}`);
  for (const pod of result.pods ?? []) {
    const label = pod.isValid ? (pod.manifest?.name ?? pod.workspaceKey) : "INVALID";
    console.log(
      `${pod.workspaceKey}  ${label}${pod.manifest?.version ? ` v${pod.manifest.version}` : ""}`,
    );
    for (const entrypoint of pod.manifest?.entrypoints ?? [])
      console.log(
        `  ${entrypoint.id}  ${entrypoint.sourcePath}${entrypoint.name ? `  ${entrypoint.name}` : ""}`,
      );
    for (const diagnostic of pod.diagnostics ?? [])
      console.error(`  ${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
  }
  if (!result.pods?.length) console.log("(no workspaces found — run `pea script bootstrap`)");
}

function writeScriptPodImport(result: HostOpResponse<"scripting.pod.import">) {
  console.log(`status    ${result.status}`);
  console.log(`workspace ${result.workspaceKey ?? "unknown"}`);
  console.log(`root      ${result.workspaceRootPath ?? "unknown"}`);
  console.log(`archive   ${result.archivePath}`);
  console.log(`entries   ${result.archiveEntries?.length ?? 0}`);
}

function writeScriptPodExport(result: HostOpResponse<"scripting.pod.export">) {
  console.log(`status    ${result.status}`);
  console.log(`workspace ${result.workspaceKey ?? "unknown"}`);
  console.log(`archive   ${result.archivePath}`);
  console.log(`entries   ${result.archiveEntries?.length ?? 0}`);
}

function parseOperationVerbosity(value: unknown): "compact" | "hints" | "full" {
  switch (asOptionalString(value) ?? "compact") {
    case "compact":
      return "compact";
    case "hints":
      return "hints";
    case "full":
      return "full";
    default:
      throw new Error("Unknown verbosity. Expected compact, hints, or full.");
  }
}

function parseOperationIntent(value: unknown): "Read" | "Mutate" | undefined {
  const text = firstNonBlank(value);
  if (!text) return undefined;
  switch (text) {
    case "Read":
    case "Mutate":
      return text;
    default:
      throw new Error("Unknown operation intent. Expected Read or Mutate.");
  }
}

function parseLogTarget(target: unknown): HostLogTarget {
  switch ((asOptionalString(target) ?? "all").toLowerCase()) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
      return HostLogTarget.Revit;
    case "all":
      return HostLogTarget.All;
    default:
      throw new Error("Unknown log target. Expected host, revit, or all.");
  }
}

function parseOptionalJson(value: unknown): unknown {
  const text = firstNonBlank(value);
  if (!text) return undefined;
  return JSON.parse(text);
}
