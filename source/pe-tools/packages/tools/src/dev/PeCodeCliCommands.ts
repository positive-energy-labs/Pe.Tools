import { readFile } from "node:fs/promises";
import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import {
  collectRuntimeLoopContext,
  defaultLiveLoopTimeoutSeconds,
  defaultRiderBridgeBaseUrl,
  restartLiveRrd,
  syncLiveRrd,
  type LiveRrdRestartReadinessLevel,
} from "../shared/live-loop.ts";
import { ScriptingTools } from "../shared/scripting.ts";
import type { ScriptExecuteInput } from "../shared/scripting.ts";
import { talkToPeaHarness } from "./talk-to-pea.ts";

export interface PeCodeCliCommandOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
}

export class PeCodeCliCommands {
  constructor(private readonly options: PeCodeCliCommandOptions = {}) {}

  commands() {
    return {
      live: this.liveCommand(),
      script: this.scriptCommand(),
      "talk-to-pea": this.talkToPeaCommand(),
    };
  }

  liveCommand() {
    return define({
      name: "live",
      description: "Inspect, sync, and restart the Rider-driven Revit development loop.",
      examples: ["pe-code live context", "pe-code live sync", "pe-code live restart"].join("\n"),
      subCommands: {
        context: this.liveContextCommand(),
        sync: this.liveSyncCommand(),
        restart: this.liveRestartCommand(),
      },
      run: () => {
        console.log("Run `pe-code live --help` to list live-loop commands.");
      },
    });
  }

  scriptCommand() {
    return define({
      name: "script",
      description: "Run dev-agent scripting tools through Pe.Host with a live RRD sync preflight.",
      subCommands: {
        execute: this.scriptExecuteCommand(),
      },
      run: () => {
        console.log("Run `pe-code script --help` to list script commands.");
      },
    });
  }

  private liveContextCommand() {
    return define({
      name: "context",
      description:
        "Collect a read-only live-runtime decision packet without syncing, mutating, or restarting.",
      args: {
        host: commonArgs.host,
        logTail: { type: "number", description: "Log tail lines to include.", default: 10 },
        resetLogCursor: {
          type: "boolean",
          description: "Reset log cursors after reading.",
          default: false,
        },
        includeLastSync: {
          type: "boolean",
          description: "Include the last RiderBridge sync summary when known.",
          default: true,
        },
        timeoutSeconds: commonArgs.timeoutSeconds,
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await collectRuntimeLoopContext({
          hostBaseUrl: this.resolveHostBaseUrl(ctx.values.host),
          logTail: ctx.values.logTail,
          resetLogCursor: ctx.values.resetLogCursor,
          includeLastSync: ctx.values.includeLastSync,
          timeoutSeconds: ctx.values.timeoutSeconds,
        });
        writeObject(result);
      },
    });
  }

  private liveSyncCommand() {
    return define({
      name: "sync",
      description: "Invoke the RiderBridge hot-reload sync for the live RRD session.",
      args: {
        timeoutSeconds: commonArgs.timeoutSeconds,
        riderBridgeBaseUrl: commonArgs.riderBridgeBaseUrl,
        project: commonArgs.project,
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await syncLiveRrd({
          timeoutSeconds: ctx.values.timeoutSeconds,
          riderBridgeBaseUrl: ctx.values.riderBridgeBaseUrl,
          project: ctx.values.project,
        });
        writeObject(result);
      },
    });
  }

  private liveRestartCommand() {
    return define({
      name: "restart",
      description: "Start or restart the Rider-driven RRD session.",
      args: {
        timeoutSeconds: commonArgs.timeoutSeconds,
        riderBridgeBaseUrl: commonArgs.riderBridgeBaseUrl,
        project: commonArgs.project,
        actionId: { type: "string", description: "Optional Rider action override." },
        expectedRevitVersion: {
          type: "string",
          description: "Expected Revit version.",
          default: "2025",
        },
        requireNewProcess: {
          type: "boolean",
          description: "Require a new Revit process after restart.",
          default: true,
        },
        readinessLevel: {
          type: "string",
          description:
            "Readiness level: BridgeConnected, ModulesLoaded, AnyDocumentOpen, or ActiveDocumentReady.",
          default: "ModulesLoaded",
        },
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await restartLiveRrd({
          timeoutSeconds: ctx.values.timeoutSeconds,
          riderBridgeBaseUrl: ctx.values.riderBridgeBaseUrl,
          project: ctx.values.project,
          actionId: ctx.values.actionId,
          expectedRevitVersion: ctx.values.expectedRevitVersion,
          requireNewProcess: ctx.values.requireNewProcess,
          readinessLevel: parseReadinessLevel(ctx.values.readinessLevel),
        });
        writeObject(result);
      },
    });
  }

  private talkToPeaCommand() {
    return define({
      name: "talk-to-pea",
      description: "Delegate to the real Pea operator agent as a black-box product harness.",
      args: {
        prompt: { type: "string", description: "Prompt sent to Pea." },
        threadId: { type: "string", description: "Existing Pea thread to continue." },
        frame: {
          type: "string",
          description: "Prompt frame: operator, feedback, or collaborate.",
          default: "operator",
        },
        feedbackPrompt: {
          type: "string",
          description: "Optional second feedback turn in the same Pea thread.",
        },
        maxMessages: { type: "number", description: "Maximum messages to read.", default: 12 },
        timeoutSeconds: commonArgs.timeoutSeconds,
      },
      toKebab: true,
      run: async (ctx) => {
        const prompt = firstNonBlank(ctx.values.prompt);
        if (!prompt) throw new Error("Provide --prompt <message>.");
        const result = await talkToPeaHarness({
          prompt,
          threadId: firstNonBlank(ctx.values.threadId),
          frame: parseTalkToPeaFrame(ctx.values.frame),
          feedbackPrompt: firstNonBlank(ctx.values.feedbackPrompt),
          maxMessages: ctx.values.maxMessages,
          timeoutSeconds: ctx.values.timeoutSeconds,
        });
        writeObject(result);
      },
    });
  }

  private scriptExecuteCommand() {
    return define({
      name: "execute",
      description:
        "Sync the live RRD loop, then execute a C# Revit script through Pe.Host from inline content, stdin, a file, or a workspace source path.",
      args: {
        host: commonArgs.host,
        workspace: commonArgs.workspace,
        timeoutSeconds: commonArgs.timeoutSeconds,
        file: { type: "string", description: "Read inline script content from a local file." },
        stdin: {
          type: "boolean",
          description: "Read inline script content from stdin.",
          default: false,
        },
        scriptContent: { type: "string", description: "Inline script content." },
        sourcePath: { type: "string", description: "Workspace-relative source path to execute." },
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
      run: async (ctx) => {
        const scriptContent = await resolveScriptContent(ctx.values);
        const sourcePath = firstNonBlank(ctx.values.sourcePath);
        if (!scriptContent && !sourcePath)
          throw new Error("Provide --file, --stdin, --script-content, or --source-path.");

        const timeoutSeconds = ctx.values.timeoutSeconds ?? defaultLiveLoopTimeoutSeconds;
        const sync = await syncLiveRrd({ timeoutSeconds });
        const script = await new ScriptingTools(
          new PeHostClient({
            baseUrl: this.resolveHostBaseUrl(ctx.values.host),
            timeoutMs: Math.max(timeoutSeconds, 1) * 1000,
          }),
          { workspaceKey: this.resolveWorkspaceKey(ctx.values.workspace) },
        ).execute({
          scriptContent,
          sourceKind: sourcePath ? "WorkspacePath" : "InlineSnippet",
          sourcePath,
          workspaceKey: ctx.values.workspace,
          sourceName: ctx.values.sourceName,
          permissionMode: parsePermissionMode(ctx.values.permissionMode),
        } satisfies ScriptExecuteInput);

        writeObject({ ok: true, workflow: "script_execute", hotReload: sync, script });
      },
    });
  }

  private resolveHostBaseUrl(value?: unknown): string {
    return PeHostClient.resolveHostBaseUrl(asOptionalString(value) ?? this.options.hostBaseUrl);
  }

  private resolveWorkspaceKey(value?: unknown): string {
    return PeHostClient.resolveWorkspaceKey(asOptionalString(value) ?? this.options.workspaceKey);
  }
}

const commonArgs = {
  host: {
    type: "string",
    description: "Pe.Host base URL.",
    default: PeHostClient.resolveHostBaseUrl(),
  },
  workspace: {
    type: "string",
    short: "w",
    description: "Pe scripting workspace or Pod name.",
    default: PeHostClient.resolveWorkspaceKey(),
  },
  timeoutSeconds: {
    type: "number",
    description: "Timeout in seconds.",
    default: defaultLiveLoopTimeoutSeconds,
  },
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

function parseReadinessLevel(value: unknown): LiveRrdRestartReadinessLevel {
  switch (asOptionalString(value) ?? "ModulesLoaded") {
    case "BridgeConnected":
      return "BridgeConnected";
    case "ModulesLoaded":
      return "ModulesLoaded";
    case "AnyDocumentOpen":
      return "AnyDocumentOpen";
    case "ActiveDocumentReady":
      return "ActiveDocumentReady";
    default:
      throw new Error(
        "Unknown readiness level. Expected BridgeConnected, ModulesLoaded, AnyDocumentOpen, or ActiveDocumentReady.",
      );
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

function parseTalkToPeaFrame(value: unknown): "operator" | "feedback" | "collaborate" {
  switch ((asOptionalString(value) ?? "operator").toLowerCase()) {
    case "operator":
      return "operator";
    case "feedback":
      return "feedback";
    case "collaborate":
      return "collaborate";
    default:
      throw new Error("Unknown frame. Expected operator, feedback, or collaborate.");
  }
}

function writeObject(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function firstNonBlank(...values: unknown[]): string | undefined {
  return values
    .map(asOptionalString)
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
