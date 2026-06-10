import { createTool } from "@mastra/core/tools";
import z from "zod";
import { runWithAttachedRrdSync } from "./attached-rrd-sync.js";
import {
  collectRuntimeLoopContext,
  defaultLiveLoopTimeoutSeconds,
  defaultRiderBridgeBaseUrl,
  restartLiveRrd,
  syncLiveRrd,
} from "../shared/live-loop.ts";
import { runAttachedRrdTest, runPeDevWorkflow } from "./pe-dev-workflow/index.js";

import { PeHostClient } from "@pe/host-client";
import { talkToPeaHarness } from "./talk-to-pea.js";
import { ScriptingTools, scriptExecuteInputSchema } from "../shared/scripting.ts";

const defaultTimeoutSeconds = defaultLiveLoopTimeoutSeconds;

const repoCommandInputSchema = z.object({
  timeoutSeconds: z.number().min(5).max(3600).default(defaultTimeoutSeconds),
});

export const liveLoopContext = createTool({
  id: "live_loop_context",
  description:
    "Collect a read-only live-runtime decision packet: environment summary, host/Revit log deltas, last sync/bridge result when known, proof-lane recommendation, and the next explicit action. Does not sync, test, mutate, or restart anything.",
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
    "Refresh the live Rider-driven RRD session by mutating PeHotReloadSignal.cs and invoking the Pe.RiderBridge localhost HTTP hot-reload endpoint directly. This is required after IDE/Rider builds of runtime packages; isolated terminal builds are not runtime freshness proof.",
  inputSchema: repoCommandInputSchema.extend({
    riderBridgeBaseUrl: z.string().url().default(defaultRiderBridgeBaseUrl),
    project: z.string().default("Pe.Tools"),
  }),
  execute: async (input) =>
    syncLiveRrd({
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      riderBridgeBaseUrl: input.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
      project: input.project ?? "Pe.Tools",
    }),
});

export const liveRrdRestart = createTool({
  id: "live_rrd_restart",
  description:
    "Start or restart the Rider-driven RRD session. Use this to manage RRD sessions to resolve assembly freshness issues or when the user asks for an RRD session to be started. No existing Rider, Revit, or host process required.",
  inputSchema: repoCommandInputSchema.extend({
    riderBridgeBaseUrl: z.string().url().default(defaultRiderBridgeBaseUrl),
    project: z.string().default("Pe.Tools"),
    actionId: z
      .string()
      .optional()
      .describe("Optional Rider action override. Defaults to trying Rerun, then Debug."),
    expectedRevitVersion: z.string().default("2025"),
    requireNewProcess: z.boolean().default(true),
    readinessLevel: z
      .enum(["BridgeConnected", "ModulesLoaded", "AnyDocumentOpen", "ActiveDocumentReady"])
      .default("ModulesLoaded"),
    openDocument: z
      .object({
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute local RVT/RFA path to open through revit.apply.document.open; cld:// cloud paths are detected but not opened yet.",
          ),
        name: z.string().min(1).optional(),
        revitYear: z.string().default("2025").optional(),
        kind: z.enum(["Project", "Family", "Any"]).default("Any").optional(),
        localFilesOnly: z
          .boolean()
          .default(true)
          .optional()
          .describe(
            "When resolving by recent-document name, keep true for currently openable local files; false may match cloud entries that are reported as unsupported.",
          ),
      })
      .nullable()
      .optional()
      .describe(
        "Optional Revit document selector to open after RRD reaches module readiness through host operation revit.apply.document.open. Local paths are supported; cloud recent-document matches are reported but not opened yet. Explicit null disables any harness state default.",
      ),
    harnessStatePath: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional repo-relative or absolute JSON file with revit.defaultOpenDocument used when openDocument is omitted.",
      ),
  }),
  execute: async (input) =>
    restartLiveRrd({
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      riderBridgeBaseUrl: input.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
      project: input.project ?? "Pe.Tools",
      actionId: input.actionId,
      expectedRevitVersion: input.expectedRevitVersion ?? "2025",
      requireNewProcess: input.requireNewProcess ?? true,
      readinessLevel: input.readinessLevel ?? "ModulesLoaded",
      openDocument: input.openDocument,
      harnessStatePath: input.harnessStatePath,
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

export const scriptExecuteWithSync = createTool({
  id: "script_execute",
  description:
    "Execute a C# Revit script through the Pe.Host scripting contract after first attempting direct Pe.RiderBridge sync. Sync failure is a loud warning, not a script blocker.",
  inputSchema: repoCommandInputSchema.merge(scriptExecuteInputSchema),
  execute: async (input) => {
    const timeoutSeconds = input.timeoutSeconds ?? defaultTimeoutSeconds;
    const synced = await runWithAttachedRrdSync(
      {
        workflow: "script_execute",
        stalePolicy: "warn",
        timeoutSeconds,
      },
      () =>
        new ScriptingTools(
          new PeHostClient({
            baseUrl: PeHostClient.resolveHostBaseUrl(),
            timeoutMs: Math.max(timeoutSeconds, 1) * 1000,
          }),
          { workspaceKey: PeHostClient.resolveWorkspaceKey() },
        ).execute(input),
    );

    return {
      ok: true,
      workflow: "script_execute",
      hotReload: {
        ok: synced.sync.ok,
        warning: synced.warning,
        sync: synced.sync,
      },
      script: synced.result,
    };
  },
});

export const test = createTool({
  id: "test",
  description:
    "Run Revit-backed tests through the condoned repo loops. Prefer FreshRevitProcess (`pe-dev test`) for autonomous proof without touching RRD. Use AttachedRrd only after an IDE/Rider runtime build and sync.",
  inputSchema: repoCommandInputSchema.extend({
    target: z.enum(["FreshRevitProcess", "AttachedRrd"]).default("FreshRevitProcess"),
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
      const args = [
        "test",
        "--filter",
        input.filter ?? "Name~Reports_runtime_assembly_load_paths",
        "--timeout-seconds",
        String(timeoutSeconds),
      ];
      if (input.planOnly) args.push("--plan", "--json");
      return runPeDevWorkflow("test", args, "FreshRevitProcess", timeoutSeconds + 30);
    }

    return runAttachedRrdTest({
      filter: input.filter ?? "Name~Reports_runtime_assembly_load_paths",
      syncFirst: input.syncFirst ?? true,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
    });
  },
});
