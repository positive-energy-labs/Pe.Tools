import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  collectPostLiveCommandHooks,
  collectRuntimeLoopContext,
  defaultPeaRuntimeTimeoutSeconds,
} from "../shared/pea-runtime-hooks.ts";
import { syncLiveRrd } from "./live-sync.js";
import { runAttachedRrdTest, runFreshRevitTest } from "./pe-revit-workflow/index.js";
import { sdkLiveWarning } from "./sdk-live.js";

import { HostRpcCaller } from "../shared/host-rpc-caller.js";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "../shared/host-config.js";
import { talkToPeaHarness } from "./talk-to-pea.js";
import { talkToPecoPsmux, talkToPecoZellij } from "./talk-to-peco-mux.ts";
import { ScriptingTools, scriptExecuteInputSchema } from "../shared/scripting.ts";

const defaultTimeoutSeconds = defaultPeaRuntimeTimeoutSeconds;

const repoCommandInputSchema = z.object({
  timeoutSeconds: z.number().min(5).max(3600).default(defaultTimeoutSeconds),
});

export const liveLoopContext = createTool({
  id: "live_loop_context",
  description:
    "Collect a read-only live-runtime packet: Pea host status, host/Revit log tails, and the last SDK sync result when known. Does not sync, test, mutate, or restart anything.",
  inputSchema: repoCommandInputSchema.extend({
    logTail: z.number().min(1).max(1000).default(10),
    resetLogCursor: z
      .boolean()
      .default(false)
      .describe(
        "Reset log cursors after reading, establishing a new baseline for the next runtime-loop check.",
      ),
    includeLastSync: z.boolean().default(true),
  }),
  execute: async (input) =>
    collectRuntimeLoopContext({
      logTail: input.logTail ?? 10,
      resetLogCursor: input.resetLogCursor ?? false,
      includeLastSync: input.includeLastSync ?? true,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
    }),
});

export const liveRrdSync = createTool({
  id: "live_rrd_sync",
  description:
    "Refresh and converge the live RRD session through SDK pe-revit live sync. Builds/deploys, can apply Rider Hot Reload, can start RRD when missing, and can include Pea host status/log hooks in the result.",
  inputSchema: repoCommandInputSchema.extend({
    project: z.string().optional(),
    revitYear: z.string().optional(),
    hotReload: z.boolean().default(true),
    start: z.boolean().default(true),
    restartOnHrBreak: z.boolean().default(false),
    includePeaStatus: z.boolean().default(true),
    logTail: z.number().min(0).max(1000).default(20),
    resetLogCursor: z.boolean().default(false),
  }),
  execute: async (input) =>
    syncLiveRrd({
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      project: input.project,
      revitYear: input.revitYear,
      hotReload: input.hotReload ?? true,
      start: input.start ?? true,
      restartOnHrBreak: input.restartOnHrBreak ?? false,
      includePeaStatus: input.includePeaStatus ?? true,
      logTail: input.logTail ?? 20,
      resetLogCursor: input.resetLogCursor ?? false,
    }),
});

export const talkToPea = createTool({
  id: "talk_to_pea",
  description:
    "Delegate to the real Pea operator agent as a black-box product harness. Stateful by Pea threadId. Use operator for user-facing answers, feedback for harness/product critique, and collaborate for exploratory Revit/project convention research. For harness feedback, start from normal imperfect user questions rather than tool-shaped prompts whenever possible.",
  inputSchema: repoCommandInputSchema.extend({
    threadId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Existing Pea thread to continue. Omit to create a new Pea review/collaboration thread.",
      ),
    frame: z
      .enum(["operator", "feedback", "collaborate"])
      .default("operator")
      .describe(
        "Prompt frame sent to Pea. This is not a Mastra mode; it only changes the task framing.",
      ),
    prompt: z.string().min(1),
    feedbackPrompt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional second feedback turn sent in the same Pea thread after the primary prompt.",
      ),
    reviewFrame: z
      .object({
        userRequest: z.string().min(1).optional(),
        engineerQuestion: z.string().min(1).optional(),
        expectedUse: z.string().min(1).optional(),
      })
      .optional(),
    maxMessages: z.number().min(2).max(40).default(12),
  }),
  execute: async (input) =>
    talkToPeaHarness({
      threadId: input.threadId,
      frame: input.frame ?? "operator",
      prompt: input.prompt,
      feedbackPrompt: input.feedbackPrompt,
      reviewFrame: input.reviewFrame,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      maxMessages: input.maxMessages ?? 12,
    }),
});

const talkToPecoMuxInputSchema = repoCommandInputSchema.extend({
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe("Optional first prompt to type into the newly opened peco TUI pane."),
  cwd: z.string().min(1).optional().describe("Repo path used as the pane working directory."),
  direction: z.enum(["right", "down"]).default("right"),
  startupDelayMs: z.number().min(0).max(60000).default(7000),
  postSubmitDelayMs: z.number().min(0).max(60000).default(2500),
  dumpScreen: z.boolean().default(true),
  dumpFullScrollback: z.boolean().default(false),
});

export const talkToPecoZellijTool = createTool({
  id: "talk_to_peco_zellij",
  description:
    "POC: open a second peco TUI in a new zellij pane and optionally talk to it by sending terminal input with zellij write-chars/send-keys.",
  inputSchema: talkToPecoMuxInputSchema,
  execute: async (input) =>
    talkToPecoZellij({
      prompt: input.prompt,
      cwd: input.cwd,
      direction: input.direction,
      startupDelayMs: input.startupDelayMs,
      postSubmitDelayMs: input.postSubmitDelayMs,
      timeoutSeconds: input.timeoutSeconds,
      dumpScreen: input.dumpScreen,
      dumpFullScrollback: input.dumpFullScrollback,
    }),
});

export const talkToPecoPsmuxTool = createTool({
  id: "talk_to_peco_psmux",
  description:
    "POC: open a second peco TUI in a psmux/tmux pane and optionally talk to it by sending terminal input with tmux send-keys.",
  inputSchema: talkToPecoMuxInputSchema.extend({
    sessionName: z.string().min(1).default("peco-mux-poc"),
    attachInZellij: z
      .boolean()
      .default(true)
      .describe(
        "When not already inside psmux/tmux, also open a zellij pane attached to the tmux session for visibility.",
      ),
  }),
  execute: async (input) =>
    talkToPecoPsmux({
      prompt: input.prompt,
      cwd: input.cwd,
      direction: input.direction,
      startupDelayMs: input.startupDelayMs,
      postSubmitDelayMs: input.postSubmitDelayMs,
      timeoutSeconds: input.timeoutSeconds,
      dumpScreen: input.dumpScreen,
      dumpFullScrollback: input.dumpFullScrollback,
      sessionName: input.sessionName,
      attachInZellij: input.attachInZellij,
    }),
});

export const scriptExecuteWithSync = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the TS host scripting contract after first attempting SDK live sync. Sync failure is a loud warning, not a script blocker.",
  inputSchema: repoCommandInputSchema.merge(scriptExecuteInputSchema),
  execute: async (input) => {
    const timeoutSeconds = input.timeoutSeconds ?? defaultTimeoutSeconds;
    const sync = await syncLiveRrd({ timeoutSeconds });
    const script = await new ScriptingTools(
      new HostRpcCaller({
        hostBaseUrl: resolveHostBaseUrl(),
        timeoutMs: Math.max(timeoutSeconds, 1) * 1000,
      }),
      { workspaceKey: resolveWorkspaceKey() },
    ).execute(input);

    return {
      ok: true,
      workflow: "script_execute",
      liveSync: {
        ok: sync.ok,
        warning: sdkLiveWarning(sync),
        sync,
      },
      script,
    };
  },
});

export const test = createTool({
  id: "test",
  description:
    "Run Revit-backed tests through SDK pe-revit test. Prefer FreshRevitProcess for autonomous proof without touching RRD. Use AttachedRrd only after SDK live sync.",
  inputSchema: repoCommandInputSchema.extend({
    target: z.enum(["FreshRevitProcess", "AttachedRrd"]).default("FreshRevitProcess"),
    project: z.string().optional(),
    revitYear: z.string().optional(),
    filter: z.string().default("Name~Reports_runtime_assembly_load_paths"),
    planOnly: z
      .boolean()
      .default(false)
      .describe(
        "For FreshRevitProcess only: resolve and print the plan without launching Revit or running tests.",
      ),
    syncFirst: z
      .boolean()
      .default(true)
      .describe("For AttachedRrd only: run sync before the build/test sequence."),
  }),
  execute: async (input) => {
    if ((input.target ?? "FreshRevitProcess") === "FreshRevitProcess") {
      const timeoutSeconds = input.timeoutSeconds ?? defaultTimeoutSeconds;
      const result = await runFreshRevitTest({
        filter: input.filter ?? "Name~Reports_runtime_assembly_load_paths",
        project: input.project,
        revitYear: input.revitYear,
        planOnly: input.planOnly ?? false,
        timeoutSeconds,
      });
      const hooks = await collectPostLiveCommandHooks({
        includePeaStatus: true,
        logTail: 20,
        resetLogCursor: false,
      });
      return { ...result, hooks };
    }

    const result = await runAttachedRrdTest({
      filter: input.filter ?? "Name~Reports_runtime_assembly_load_paths",
      project: input.project,
      revitYear: input.revitYear,
      syncFirst: input.syncFirst ?? true,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
    });
    const hooks = await collectPostLiveCommandHooks({
      includePeaStatus: true,
      logTail: 20,
      resetLogCursor: false,
    });
    return { ...result, hooks };
  },
});
