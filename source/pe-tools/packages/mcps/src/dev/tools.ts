import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  collectRuntimeLoopContext,
  defaultPeaRuntimeTimeoutSeconds,
} from "../shared/pea-runtime-hooks.ts";
import { syncLiveRrd } from "./live-sync.js";
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
    "Execute a C# Revit script through the TS host scripting contract after first attempting SDK live convergence. Live convergence failure is a loud warning, not a script blocker.",
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
