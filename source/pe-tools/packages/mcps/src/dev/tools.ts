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
import { talkToPecoZellij } from "./talk-to-peco-mux.ts";
import {
  ScriptingTools,
  scriptClientTimeoutMs,
  scriptExecuteInputSchema,
} from "../shared/scripting.ts";

const defaultTimeoutSeconds = defaultPeaRuntimeTimeoutSeconds;

const repoCommandInputSchema = z.object({
  timeoutSeconds: z.number().min(5).max(3600).default(defaultTimeoutSeconds),
});

export const liveLoopContext = createTool({
  id: "live_loop_context",
  description:
    "Collect a read-only live-runtime packet: Pea host status, host/Revit log tails, and the last SDK sync result when known. Does not sync, test, mutate, or restart anything.",
  inputSchema: repoCommandInputSchema.extend({
    logTail: z
      .number()
      .min(1)
      .max(1000)
      .default(10)
      .describe("Lines to read from the end of each log."),
    resetLogCursor: z
      .boolean()
      .default(false)
      .describe(
        "Reset log cursors after reading, establishing a new baseline for the next runtime-loop check.",
      ),
    includeLastSync: z
      .boolean()
      .default(true)
      .describe("Include the last SDK live-sync result when one is known."),
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
  startupDelayMs: z
    .number()
    .min(0)
    .max(60000)
    .default(7000)
    .describe("Wait for the TUI to boot before typing. Raise only if the pane comes up slow."),
  postSubmitDelayMs: z
    .number()
    .min(0)
    .max(60000)
    .default(2500)
    .describe("Wait after submitting the prompt before reading the screen."),
  dumpFullScrollback: z
    .boolean()
    .default(false)
    .describe("Return the pane's full scrollback instead of just the visible screen."),
});

export const talkToPecoZellijTool = createTool({
  id: "talk_to_peco_zellij",
  description:
    "Open a second peco TUI in a new zellij pane and drive it by sending terminal input. Use to reproduce or observe peco TUI behavior hands-on; returns the pane's screen text after the prompt runs.",
  inputSchema: talkToPecoMuxInputSchema,
  execute: async (input) =>
    talkToPecoZellij({
      prompt: input.prompt,
      cwd: input.cwd,
      startupDelayMs: input.startupDelayMs,
      postSubmitDelayMs: input.postSubmitDelayMs,
      timeoutSeconds: input.timeoutSeconds,
      dumpFullScrollback: input.dumpFullScrollback,
    }),
});

export const scriptExecuteWithSync = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the host scripting contract. Pass scriptContent for an inline snippet (prefer Execute-body statements like WriteLine(...); a full PeScriptContainer class is also allowed) OR sourcePath for a pod entrypoint declared in the workspace's pod.json — not both. Defaults to ReadOnly: document changes are rolled back and discarded with a warning; pass permissionMode=WriteTransaction to keep changes. Use Result(...) in the script for structured JSON results; scripts should check ct / ThrowIfCancelled() in loops so the timeout (default 600s) and scripting.cancel can interrupt them. In peco, SDK live convergence runs first; a convergence failure is reported in liveSync as a loud warning, not a script blocker.",
  inputSchema: repoCommandInputSchema.merge(scriptExecuteInputSchema),
  execute: async (input) => {
    const timeoutSeconds = input.timeoutSeconds ?? defaultTimeoutSeconds;
    const sync = await syncLiveRrd({ timeoutSeconds });
    const script = await new ScriptingTools(
      new HostRpcCaller({
        hostBaseUrl: resolveHostBaseUrl(),
        timeoutMs: scriptClientTimeoutMs(timeoutSeconds),
      }),
      { workspaceKey: resolveWorkspaceKey() },
    ).execute({ ...input, timeoutSeconds });

    // Same contract as pea's script_execute (the host result), plus the peco-only
    // liveSync report as a sibling field.
    return {
      ...script,
      liveSync: {
        ok: sync.ok,
        warning: sdkLiveWarning(sync),
        sync,
      },
    };
  },
});
