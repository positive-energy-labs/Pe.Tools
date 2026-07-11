import { define } from "gunshi";
import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import {
  collectRuntimeLoopContext,
  defaultPeaRuntimeTimeoutSeconds,
} from "../shared/pea-runtime-hooks.ts";
import { syncLiveRrd } from "./live-sync.ts";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.ts";
import { asOptionalString, firstNonBlank } from "../shared/cli-values.ts";
import {
  ScriptingTools,
  parseCliPermissionMode,
  resolveCliScriptContent,
  scriptClientTimeoutMs,
} from "../shared/scripting.ts";
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
      "talk-to-peco-zellij": this.talkToPecoZellijCommand(),
    };
  }

  liveCommand() {
    return define({
      name: "live",
      description: "Inspect Peco runtime context around the SDK-driven Revit development loop.",
      examples: ["peco live context"].join("\n"),
      subCommands: {
        context: this.liveContextCommand(),
      },
      run: () => {
        console.log("Run `peco live --help` to list live commands.");
      },
    });
  }

  scriptCommand() {
    return define({
      name: "script",
      description:
        "Run peco scripting tools through the TS host with a live RRD convergence preflight.",
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
          description: "Do not include the last SDK live summary.",
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
        "Converge the live RRD loop, then execute a C# Revit script through the TS host from inline content, stdin, a file, or a workspace source path.",
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
        },
        permissionMode: {
          type: "string",
          description:
            "Script permission mode: ReadOnly (default; changes discarded) or WriteTransaction (changes kept).",
        },
      },
      toKebab: true,
      run: async (ctx) => {
        const scriptContent = await resolveCliScriptContent(ctx.values);
        const sourcePath = firstNonBlank(ctx.values.sourcePath);
        if (!scriptContent && !sourcePath)
          throw new Error("Provide --file, --stdin, --script-content, or --source-path.");
        if (scriptContent && sourcePath)
          throw new Error(
            "Provide inline content (--file/--stdin/--script-content) or --source-path, not both.",
          );

        const timeoutSeconds = ctx.values.timeoutSeconds ?? defaultPeaRuntimeTimeoutSeconds;
        const sync = await syncLiveRrd({ timeoutSeconds });
        const script = await new ScriptingTools(
          new HostRpcCaller({
            hostBaseUrl: this.resolveHostBaseUrl(ctx.values.host),
            timeoutMs: scriptClientTimeoutMs(timeoutSeconds),
          }),
          { workspaceKey: this.resolveWorkspaceKey(ctx.values.workspace) },
        ).execute({
          scriptContent,
          sourcePath,
          workspaceKey: ctx.values.workspace,
          sourceName: firstNonBlank(ctx.values.sourceName),
          permissionMode: parseCliPermissionMode(ctx.values.permissionMode),
          timeoutSeconds,
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
} as const;

function resolvePecoMuxCliRequest(values: Record<string, unknown>): TalkToPecoMuxRequest {
  return {
    prompt: firstNonBlank(values.prompt),
    cwd: firstNonBlank(values.cwd),
    startupDelayMs: asOptionalNumber(values.startupDelayMs) ?? 7000,
    postSubmitDelayMs: asOptionalNumber(values.postSubmitDelayMs) ?? 2500,
    timeoutSeconds: asOptionalNumber(values.timeoutSeconds) ?? 90,
    dumpFullScrollback: values.dumpFullScrollback === true,
  };
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
