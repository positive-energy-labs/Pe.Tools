import { readFile } from "node:fs/promises";
import { define } from "gunshi";
import { HostLogTarget, type HostOpResponse } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { ScriptingTools } from "../shared/scripting.ts";
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
        "pea script execute --source-path src\\SampleScript.cs",
        "pea script export --workspace panel-audit --output .\\panel-audit.zip",
        "pea script import --archive .\\panel-audit.zip",
      ].join("\n"),
      subCommands: {
        bootstrap: this.scriptBootstrapCommand(),
        execute: this.scriptExecuteCommand(),
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
        "Execute a C# Revit script through the host from inline content, stdin, a file, or a workspace source path.",
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
          description: "Workspace-relative source path to execute.",
        },
        sourceName: {
          type: "string",
          description: "Synthetic source filename used for diagnostics.",
          default: "AgentSnippet.cs",
        },
        permissionMode: {
          type: "string",
          description: "Script permission mode: ReadOnly or WriteTransaction.",
          default: "ReadOnly",
        },
      },
      toKebab: true,
      examples: [
        "pea script execute --file scratch\\Probe.cs",
        "pea script execute --source-path src\\SampleScript.cs",
        "Get-Content .\\Probe.cs | pea script execute --stdin --source-name Probe.cs",
      ].join("\n"),
      run: async (ctx) => {
        const scriptContent = await resolveScriptContent(ctx.values);
        const sourcePath = firstNonBlank(ctx.values.sourcePath);
        if (!scriptContent && !sourcePath)
          throw new Error("Provide --file, --stdin, --script-content, or --source-path.");

        const result = await this.createScriptingTools(ctx.values).execute({
          scriptContent,
          sourceKind: sourcePath ? "WorkspacePath" : "InlineSnippet",
          sourcePath,
          workspaceKey: ctx.values.workspace,
          sourceName: ctx.values.sourceName,
          permissionMode: parsePermissionMode(ctx.values.permissionMode),
        } satisfies ScriptExecuteInput);
        writeScriptExecution(result);
      },
    });
  }

  private scriptBootstrapCommand() {
    return define({
      name: "bootstrap",
      description: "Create or update a Pe scripting workspace through the host.",
      args: {
        ...commonArgs,
        noSample: {
          type: "boolean",
          description: "Do not create the sample script file.",
          default: false,
        },
      },
      toKebab: true,
      examples: [
        "pea script bootstrap",
        "pea script bootstrap --workspace default --no-sample",
      ].join("\n"),
      run: async (ctx) => {
        const result = await this.createScriptingTools(ctx.values).bootstrap({
          workspaceKey: ctx.values.workspace,
          createSampleScript: !ctx.values.noSample,
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

  private createScriptingTools(values: Record<string, unknown>): ScriptingTools {
    return new ScriptingTools(this.createHostRpcCaller(values), {
      workspaceKey: this.resolveWorkspaceKey(values.workspace),
    });
  }

  private createHostRpcCaller(values: Record<string, unknown>): HostRpcCaller {
    return new HostRpcCaller({
      hostBaseUrl: this.resolveHostBaseUrl(values.host),
      bridgeSessionId: asOptionalString(values.bridgeSessionId),
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

async function resolveScriptContent(values: Record<string, unknown>): Promise<string | undefined> {
  const explicit = firstNonBlank(values.scriptContent);
  if (explicit) return explicit;

  const file = firstNonBlank(values.file);
  if (file) return readFile(file, "utf-8");

  if (values.stdin === true) return readStdin();
  return undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      content += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(content));
  });
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
  for (const diagnostic of result.diagnostics ?? [])
    console.error(`${diagnostic.severity} ${diagnostic.stage}: ${diagnostic.message}`);
}

function writeScriptBootstrap(result: HostOpResponse<"scripting.workspace.bootstrap">) {
  console.log(`workspace key ${result.workspaceKey}`);
  console.log(`product home ${result.productHomePath}`);
  console.log(`workspace    ${result.workspaceRootPath}`);
  console.log(`project      ${result.projectFilePath}`);
  console.log(`sample       ${result.sampleScriptPath}`);
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

function parsePermissionMode(value: unknown): "ReadOnly" | "WriteTransaction" {
  switch (asOptionalString(value) ?? "ReadOnly") {
    case "ReadOnly":
      return "ReadOnly";
    case "WriteTransaction":
      return "WriteTransaction";
    default:
      throw new Error("Unknown permission mode. Expected ReadOnly or WriteTransaction.");
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
