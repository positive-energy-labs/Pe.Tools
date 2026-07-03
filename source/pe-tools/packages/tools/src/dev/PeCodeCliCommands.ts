import { readFile } from "node:fs/promises";
import { define } from "gunshi";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import {
  collectRuntimeLoopContext,
  defaultLiveLoopTimeoutSeconds,
  defaultRiderBridgeBaseUrl,
  restartLiveRrd,
  syncLiveRrd,
  type LiveRrdRestartReadinessLevel,
} from "../shared/live-loop.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { asOptionalString, firstNonBlank } from "../shared/cli-values.ts";
import { ScriptingTools } from "../shared/scripting.ts";
import type { ScriptExecuteInput } from "../shared/scripting.ts";
import { talkToPeaHarness } from "./talk-to-pea.ts";
import { talkToPecoZellij, type TalkToPecoMuxRequest } from "./talk-to-peco-mux.ts";

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
      // "talk-to-peco-psmux": this.talkToPecoPsmuxCommand(),
      "talk-to-peco-zellij": this.talkToPecoZellijCommand(),
    };
  }

  liveCommand() {
    return define({
      name: "live",
      description: "Inspect, sync, and restart the Rider-driven Revit development loop.",
      examples: ["peco live context", "peco live sync", "peco live restart"].join("\n"),
      subCommands: {
        context: this.liveContextCommand(),
        sync: this.liveSyncCommand(),
        restart: this.liveRestartCommand(),
      },
      run: () => {
        console.log("Run `peco live --help` to list live-loop commands.");
      },
    });
  }

  scriptCommand() {
    return define({
      name: "script",
      description: "Run peco scripting tools through the TS host with a live RRD sync preflight.",
      subCommands: {
        execute: this.scriptExecuteCommand(),
      },
      run: () => {
        console.log("Run `peco script --help` to list script commands.");
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
        logTail: {
          type: "number",
          description: "Log tail lines to include.",
          default: 10,
        },
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
        actionId: {
          type: "string",
          description: "Optional Rider action override.",
        },
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
        threadId: {
          type: "string",
          description: "Existing Pea thread to continue.",
        },
        frame: {
          type: "string",
          description: "Prompt frame: operator, feedback, or collaborate.",
          default: "operator",
        },
        feedbackPrompt: {
          type: "string",
          description: "Optional second feedback turn in the same Pea thread.",
        },
        maxMessages: {
          type: "number",
          description: "Maximum messages to read.",
          default: 12,
        },
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

  private talkToPecoZellijCommand() {
    return define({
      name: "talk-to-peco-zellij",
      description:
        "POC: open peco in a new zellij pane and optionally send it a prompt through zellij key input.",
      args: pecoMuxArgs,
      toKebab: true,
      run: async (ctx) => {
        const result = await talkToPecoZellij(resolvePecoMuxCliRequest(ctx.values));
        writeObject(result);
      },
    });
  }

  private scriptExecuteCommand() {
    return define({
      name: "execute",
      description:
        "Sync the live RRD loop, then execute a C# Revit script through the TS host from inline content, stdin, a file, or a workspace source path.",
      args: {
        host: commonArgs.host,
        workspace: commonArgs.workspace,
        timeoutSeconds: commonArgs.timeoutSeconds,
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
          description: "Inline script content.",
        },
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
      run: async (ctx) => {
        const scriptContent = await resolveScriptContent(ctx.values);
        const sourcePath = firstNonBlank(ctx.values.sourcePath);
        if (!scriptContent && !sourcePath)
          throw new Error("Provide --file, --stdin, --script-content, or --source-path.");

        const timeoutSeconds = ctx.values.timeoutSeconds ?? defaultLiveLoopTimeoutSeconds;
        const sync = await syncLiveRrd({ timeoutSeconds });
        const script = await new ScriptingTools(
          new HostRpcCaller({
            hostBaseUrl: this.resolveHostBaseUrl(ctx.values.host),
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

        writeObject({
          ok: true,
          workflow: "script_execute",
          hotReload: sync,
          script,
        });
      },
    });
  }

  private resolveHostBaseUrl(value?: unknown): string {
    return resolveHostBaseUrl(asOptionalString(value) ?? this.options.hostBaseUrl);
  }

  private resolveWorkspaceKey(value?: unknown): string {
    return resolveWorkspaceKey(asOptionalString(value) ?? this.options.workspaceKey);
  }
}

const pecoMuxArgs = {
  prompt: {
    type: "string",
    description: "Optional first prompt to type into the newly opened peco TUI pane.",
  },
  cwd: {
    type: "string",
    description: "Repo path used as the pane working directory.",
  },
  direction: {
    type: "string",
    description: "Pane split direction: right or down.",
    default: "right",
  },
  startupDelayMs: {
    type: "number",
    description: "Milliseconds to wait for the TUI to start before sending the prompt.",
    default: 7000,
  },
  postSubmitDelayMs: {
    type: "number",
    description: "Milliseconds to wait after submitting the prompt before dumping the screen.",
    default: 2500,
  },
  timeoutSeconds: {
    type: "number",
    description: "Timeout in seconds.",
    default: 90,
  },
  dumpScreen: {
    type: "boolean",
    description: "Dump the target pane screen after launch/send.",
    default: true,
  },
  dumpFullScrollback: {
    type: "boolean",
    description: "Include full mux scrollback in the screen dump when supported.",
    default: false,
  },
} as const;

const commonArgs = {
  host: {
    type: "string",
    description: "TS host base URL.",
    default: resolveHostBaseUrl(),
  },
  workspace: {
    type: "string",
    short: "w",
    description: "Pe scripting workspace or Pod name.",
    default: resolveWorkspaceKey(),
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

function resolvePecoMuxCliRequest(values: Record<string, unknown>): TalkToPecoMuxRequest {
  const direction = asOptionalString(values.direction) ?? "right";
  if (direction !== "right" && direction !== "down") {
    throw new Error("Unknown direction. Expected right or down.");
  }

  return {
    prompt: firstNonBlank(values.prompt),
    cwd: firstNonBlank(values.cwd),
    direction,
    startupDelayMs: asOptionalNumber(values.startupDelayMs) ?? 7000,
    postSubmitDelayMs: asOptionalNumber(values.postSubmitDelayMs) ?? 2500,
    timeoutSeconds: asOptionalNumber(values.timeoutSeconds) ?? 90,
    dumpScreen: values.dumpScreen !== false,
    dumpFullScrollback: values.dumpFullScrollback === true,
  };
}

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

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
