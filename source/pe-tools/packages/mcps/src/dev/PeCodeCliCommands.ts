import { readFile } from "node:fs/promises";
import { define } from "gunshi";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import {
  collectPostLiveCommandHooks,
  collectRuntimeLoopContext,
  defaultPeaRuntimeTimeoutSeconds,
} from "../shared/pea-runtime-hooks.ts";
import { syncLiveRrd } from "./live-sync.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { asOptionalString, firstNonBlank } from "../shared/cli-values.ts";
import { ScriptingTools } from "../shared/scripting.ts";
import type { ScriptExecuteInput } from "../shared/scripting.ts";
import { talkToPeaHarness } from "./talk-to-pea.ts";
import { talkToPecoZellij, type TalkToPecoMuxRequest } from "./talk-to-peco-mux.ts";
import { runAttachedRrdTest, runFreshRevitTest } from "./pe-revit-workflow/index.ts";

export interface PeCodeCliCommandOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
}

export class PeCodeCliCommands {
  constructor(private readonly options: PeCodeCliCommandOptions = {}) {}

  commands() {
    return {
      live: this.liveCommand(),
      test: this.testCommand(),
      script: this.scriptCommand(),
      "talk-to-pea": this.talkToPeaCommand(),
      // "talk-to-peco-psmux": this.talkToPecoPsmuxCommand(),
      "talk-to-peco-zellij": this.talkToPecoZellijCommand(),
    };
  }

  liveCommand() {
    return define({
      name: "live",
      description: "Inspect, sync, and restart the SDK-driven Revit development loop.",
      examples: ["peco live context", "peco live sync"].join("\n"),
      subCommands: {
        context: this.liveContextCommand(),
        sync: this.liveSyncCommand(),
      },
      run: () => {
        console.log("Run `peco live --help` to list live commands.");
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
      description: "Collect read-only Pea host status, host/Revit logs, and last SDK sync state.",
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
        noLastSync: {
          type: "boolean",
          description: "Do not include the last SDK live sync summary.",
          default: false,
        },
        timeoutSeconds: commonArgs.timeoutSeconds,
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await collectRuntimeLoopContext({
          hostBaseUrl: this.resolveHostBaseUrl(ctx.values.host),
          logTail: ctx.values.logTail,
          resetLogCursor: ctx.values.resetLogCursor,
          includeLastSync: !ctx.values.noLastSync,
          timeoutSeconds: ctx.values.timeoutSeconds,
        });
        writeObject(result);
      },
    });
  }

  private liveSyncCommand() {
    return define({
      name: "sync",
      description: "Invoke SDK pe-revit live sync for the live RRD session.",
      args: {
        timeoutSeconds: commonArgs.timeoutSeconds,
        project: commonArgs.project,
        revitYear: commonArgs.revitYear,
        noHotReload: {
          type: "boolean",
          description: "Do not try Rider Hot Reload when sync finds an attached stale assembly.",
          default: false,
        },
        noStart: {
          type: "boolean",
          description: "Do not start Rider/RRD when sync finds no live bridge or loaded addin.",
          default: false,
        },
        restartOnHrBreak: {
          type: "boolean",
          description: "Restart RRD when Hot Reload cannot converge stale attached code.",
          default: false,
        },
        noPeaStatus: {
          type: "boolean",
          description: "Do not include Pea host status in the output hook packet.",
          default: false,
        },
        logTail: {
          type: "number",
          description: "Pea host/Revit log tail lines to include; 0 disables log hook output.",
          default: 20,
        },
        resetLogCursor: {
          type: "boolean",
          description: "Reset log cursors after reading the hook packet.",
          default: false,
        },
      },
      toKebab: true,
      run: async (ctx) => {
        const result = await syncLiveRrd({
          timeoutSeconds: ctx.values.timeoutSeconds,
          project: asOptionalString(ctx.values.project),
          revitYear: asOptionalString(ctx.values.revitYear),
          hotReload: !ctx.values.noHotReload,
          start: !ctx.values.noStart,
          restartOnHrBreak: ctx.values.restartOnHrBreak,
          includePeaStatus: !ctx.values.noPeaStatus,
          logTail: ctx.values.logTail,
          resetLogCursor: ctx.values.resetLogCursor,
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

        const timeoutSeconds = ctx.values.timeoutSeconds ?? defaultPeaRuntimeTimeoutSeconds;
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
          liveSync: sync,
          script,
        });
      },
    });
  }

  private testCommand() {
    return define({
      name: "test",
      description: "Run SDK pe-revit tests and append Pea status/log hooks.",
      args: {
        target: {
          type: "string",
          description: "Test lane: FreshRevitProcess or AttachedRrd.",
          default: "FreshRevitProcess",
        },
        project: {
          type: "string",
          description: "Revit test project path.",
        },
        revitYear: commonArgs.revitYear,
        filter: {
          type: "string",
          description: "VSTest filter.",
          default: "Name~Reports_runtime_assembly_load_paths",
        },
        planOnly: {
          type: "boolean",
          description: "For FreshRevitProcess only: resolve the test plan without launching Revit.",
          default: false,
        },
        noSync: {
          type: "boolean",
          description: "For AttachedRrd only: skip SDK live sync before running tests.",
          default: false,
        },
        noPeaStatus: {
          type: "boolean",
          description: "Do not include Pea host status in the hook packet.",
          default: false,
        },
        logTail: {
          type: "number",
          description: "Pea host/Revit log tail lines to include; 0 disables log hook output.",
          default: 20,
        },
        resetLogCursor: {
          type: "boolean",
          description: "Reset log cursors after reading the hook packet.",
          default: false,
        },
        timeoutSeconds: commonArgs.timeoutSeconds,
      },
      toKebab: true,
      run: async (ctx) => {
        const target = parseTestTarget(ctx.values.target);
        const timeoutSeconds = ctx.values.timeoutSeconds ?? defaultPeaRuntimeTimeoutSeconds;
        const project = asOptionalString(ctx.values.project);
        const revitYear = asOptionalString(ctx.values.revitYear);
        const filter =
          asOptionalString(ctx.values.filter) ?? "Name~Reports_runtime_assembly_load_paths";
        const hooksRequest = {
          includePeaStatus: !ctx.values.noPeaStatus,
          logTail: asOptionalNumber(ctx.values.logTail) ?? 20,
          resetLogCursor: ctx.values.resetLogCursor === true,
        };

        if (target === "FreshRevitProcess") {
          const result = await runFreshRevitTest({
            filter,
            project,
            revitYear,
            planOnly: ctx.values.planOnly === true,
            timeoutSeconds,
          });
          writeObject({
            ...result,
            hooks: await collectPostLiveCommandHooks(hooksRequest),
          });
          return;
        }

        if (ctx.values.planOnly) throw new Error("--plan-only only applies to FreshRevitProcess.");
        const result = await runAttachedRrdTest({
          filter,
          project,
          revitYear,
          syncFirst: !ctx.values.noSync,
          timeoutSeconds,
        });
        writeObject({
          ...result,
          hooks: await collectPostLiveCommandHooks(hooksRequest),
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
    default: defaultPeaRuntimeTimeoutSeconds,
  },
  project: {
    type: "string",
    description: "Revit addin project path.",
  },
  revitYear: {
    type: "string",
    description: "Revit year.",
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

function parseTestTarget(value: unknown): "FreshRevitProcess" | "AttachedRrd" {
  const target = asOptionalString(value) ?? "FreshRevitProcess";
  switch (target) {
    case "FreshRevitProcess":
    case "AttachedRrd":
      return target;
    default:
      throw new Error("Unknown test target. Expected FreshRevitProcess or AttachedRrd.");
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
