import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import z from "zod";
import { HostLogTarget } from "../../host-client.js";
import { collectHostContext } from "./shared.js";
import { runWithAttachedRrdSync } from "./attached-rrd-sync.js";
import {
  defaultRiderBridgeBaseUrl,
  runRiderBridgeSync,
  summarizeLastSyncResult as summarizeLiveRrdLastSyncResult,
} from "./rider/index.js";
import {
  isRecord,
  resolveExecutable,
  runAttachedRrdTest,
  runPeDevWorkflow,
  type ExecutionPolicy,
} from "./pe-dev-workflow/index.js";

import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "../../pe-host.js";
import { talkToPeaHarness } from "./talk-to-pea.js";
import { runRiderBridgeRestartRrd } from "./rider/index.js";
import {
  executeScriptViaHost,
  scriptExecuteInputSchema,
} from "../shared/scripting.js";

const defaultTimeoutSeconds = 900;
const logCursorStore = new Map<string, LogCursor>();

type LogCursorMode = "read" | "reset";

interface LogCursor {
  checkedAt: string;
  size: number;
  lineCount: number;
}

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
    runRiderBridgeSync({
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      riderBridgeBaseUrl: input.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
      project: input.project ?? "Pe.Tools",
    }),
});

export const liveRrdRestart = createTool({
  id: "live_rrd_restart",
  description:
    "Start or restart the Rider-driven RRD session. If Rider is not already running, open Pe.Tools in Rider first, wait for project/debug-action readiness, then ask Pe.RiderBridge to launch/rerun the Revit debug session, poll Pe.Host for bridge/session readiness, and optionally open a local Revit document through revit.document.open. Cloud recent-document matches are detected but not opened yet.",
  inputSchema: repoCommandInputSchema.extend({
    riderBridgeBaseUrl: z.string().url().default(defaultRiderBridgeBaseUrl),
    project: z.string().default("Pe.Tools"),
    actionId: z
      .string()
      .optional()
      .describe(
        "Optional Rider action override. Defaults to trying Rerun, then Debug.",
      ),
    pollSeconds: z.number().min(0).max(600).default(180),
    pollIntervalSeconds: z.number().min(1).max(30).default(5),
    expectedRevitVersion: z.string().default("2025"),
    requireNewProcess: z.boolean().default(true),
    readinessLevel: z
      .enum([
        "BridgeConnected",
        "ModulesLoaded",
        "AnyDocumentOpen",
        "ActiveDocumentReady",
      ])
      .default("ModulesLoaded"),
    openDocument: z
      .object({
        path: z
          .string()
          .min(1)
          .optional()
          .describe("Absolute local RVT/RFA path to open through revit.document.open; cld:// cloud paths are detected but not opened yet."),
        name: z.string().min(1).optional(),
        revitYear: z.string().default("2025").optional(),
        kind: z.enum(["Project", "Family", "Any"]).default("Any").optional(),
        localFilesOnly: z
          .boolean()
          .default(true)
          .optional()
          .describe("When resolving by recent-document name, keep true for currently openable local files; false may match cloud entries that are reported as unsupported."),
      })
      .nullable()
      .optional()
      .describe(
        "Optional Revit document selector to open after RRD reaches module readiness through host operation revit.document.open. Local paths are supported; cloud recent-document matches are reported but not opened yet. Explicit null disables any harness state default.",
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
    runRiderBridgeRestartRrd({
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
      riderBridgeBaseUrl: input.riderBridgeBaseUrl ?? defaultRiderBridgeBaseUrl,
      project: input.project ?? "Pe.Tools",
      actionId: input.actionId,
      pollSeconds: input.pollSeconds ?? 180,
      pollIntervalSeconds: input.pollIntervalSeconds ?? 5,
      expectedRevitVersion: input.expectedRevitVersion ?? "2025",
      requireNewProcess: input.requireNewProcess ?? true,
      readinessLevel: input.readinessLevel ?? "ModulesLoaded",
      openDocument: input.openDocument,
      harnessStatePath: input.harnessStatePath,
    }),
});

export const liveHostRefreshSourceRun = createTool({
  id: "live_host_refresh_source_run",
  description:
    "Refresh the dev/source Pe.Host lane by launching `dotnet run` from source/Pe.Host, relying on singleton takeover, then polling Host readiness. Use after Host operation/contract changes before live Host-local or bridge-backed proof.",
  inputSchema: repoCommandInputSchema.extend({
    pollSeconds: z.number().min(0).max(600).default(60),
    pollIntervalSeconds: z.number().min(1).max(30).default(2),
  }),
  execute: async (input) =>
    runHostRefreshSourceRun({
      pollSeconds: input.pollSeconds ?? 60,
      pollIntervalSeconds: input.pollIntervalSeconds ?? 2,
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
        executeScriptViaHost(input, {
          hostBaseUrl: resolveHostBaseUrl(),
          workspaceKey: resolveWorkspaceKey(),
          timeoutSeconds,
        }),
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
    target: z
      .enum(["FreshRevitProcess", "AttachedRrd"])
      .default("FreshRevitProcess"),
    filter: z.string().default("Name~AssemblyLoadDiagnostics"),
    planOnly: z
      .boolean()
      .default(false)
      .describe(
        "For FreshRevitProcess only: resolve and print the plan without launching Revit or running tests.",
      ),
    syncFirst: z
      .boolean()
      .default(true)
      .describe(
        "For AttachedRrd only: run sync before the build/test sequence.",
      ),
  }),
  execute: async (input) => {
    if ((input.target ?? "FreshRevitProcess") === "FreshRevitProcess") {
      const timeoutSeconds = input.timeoutSeconds ?? defaultTimeoutSeconds;
      const args = [
        "test",
        "--filter",
        input.filter ?? "Name~AssemblyLoadDiagnostics",
        "--timeout-seconds",
        String(timeoutSeconds),
      ];
      if (input.planOnly) args.push("--plan", "--json");
      return runPeDevWorkflow(
        "test",
        args,
        "FreshRevitProcess",
        timeoutSeconds + 30,
      );
    }

    return runAttachedRrdTest({
      filter: input.filter ?? "Name~AssemblyLoadDiagnostics",
      syncFirst: input.syncFirst ?? true,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeoutSeconds,
    });
  },
});

async function collectRuntimeLoopContext(options: {
  logTail: number;
  resetLogCursor: boolean;
  includeLastSync: boolean;
  timeoutSeconds: number;
}) {
  const [environment, logResult] = await Promise.all([
    collectLiveLoopEnvironment({ includeHost: true }),
    readPeaHostLogTails(
      "all",
      options.logTail,
      options.resetLogCursor ? "reset" : "read",
    ),
  ]);
  const syncSummary = options.includeLastSync
    ? summarizeLiveRrdLastSyncResult()
    : null;
  const recommendation = recommendRuntimeLoopNextAction(
    environment,
    logResult,
    syncSummary,
  );

  return {
    ok: true,
    workflow: "live_loop_context",
    policy: "DiagnosticsOnly" satisfies ExecutionPolicy,
    checkedAt: new Date().toISOString(),
    environment,
    logs: logResult,
    lastSync: syncSummary,
    recommendation,
    limits: [
      "Read-only packet: does not run sync, tests, scripts, hot reload, or restart Revit/Rider.",
      "Log deltas are correlation evidence, not health proof by themselves.",
      "A successful RiderBridge sync proves IDE action invocation only until attached behavior or Revit logs confirm the runtime change.",
    ],
  };
}

function recommendRuntimeLoopNextAction(
  environment: Awaited<ReturnType<typeof collectLiveLoopEnvironment>>,
  logResult: Awaited<ReturnType<typeof readPeaHostLogTails>>,
  syncSummary: ReturnType<typeof summarizeLiveRrdLastSyncResult>,
) {
  const host = environment.host;
  const hostReachable = host?.reachable === true;
  const bridgeConnected =
    isRecord(host?.probe) && host.probe.bridgeIsConnected === true;
  const activeDocument =
    isRecord(host?.session) && host.session.activeDocument != null;
  const newLogLineCount = logResult.logs.reduce(
    (count, log) => count + log.cursor.newLineCountSinceLastCheck,
    0,
  );

  if (!hostReachable) {
    return {
      lane: "DiagnosticsOnly",
      nextAction: "read_logs",
      confidence: "high",
      reason:
        "Pe.Host is not reachable from the environment packet; inspect host/Revit logs before attempting attached runtime work.",
    };
  }

  if (!bridgeConnected) {
    return {
      lane: "AttachedRrd",
      nextAction: "ask_user",
      confidence: "high",
      reason:
        "Host is reachable but the private Revit bridge is not connected; user-maintained RRD/Revit state is the blocker.",
    };
  }

  if (!activeDocument) {
    return {
      lane: "AttachedRrd",
      nextAction: "ask_user",
      confidence: "medium",
      reason:
        "AttachedRrd appears connected but no active document was reported; document-dependent probes need user session setup first.",
    };
  }

  if (syncSummary == null) {
    return {
      lane: "AttachedRrd",
      nextAction: "live_rrd_sync",
      confidence: "medium",
      reason:
        "No sync result is known in this dev-agent process; run live_rrd_sync before relying on attached runtime behavior after runtime edits.",
    };
  }

  if (!syncSummary.ok || syncSummary.verdict === "stale") {
    return {
      lane: "AttachedRrd",
      nextAction: "live_rrd_restart",
      confidence: syncSummary.verdict === "stale" ? "high" : "medium",
      reason: `Last sync via ${syncSummary.lane} failed or reported stale freshness; recover Rider/RRD before trusting attached behavior.`,
    };
  }

  if (newLogLineCount > 0) {
    return {
      lane: "DiagnosticsOnly",
      nextAction: "read_logs",
      confidence: "medium",
      reason: `${newLogLineCount} new host/Revit log line(s) were observed since the previous cursor; inspect deltas before continuing if they correlate with a failure window.`,
    };
  }

  if (syncSummary.verdict === "unproven") {
    return {
      lane: "AttachedRrd",
      nextAction: "continue",
      confidence: "medium",
      reason: `Last sync via ${syncSummary.lane} succeeded but freshness is unproven; continue only to an attached operation/script/log proof boundary, or switch to FreshRevitProcess for proof-grade autonomous validation.`,
    };
  }

  return {
    lane: "AttachedRrd",
    nextAction: "continue",
    confidence: "high",
    reason: `Last sync via ${syncSummary.lane} is available and no new log deltas suggest a current runtime incident; continue with the next explicit attached probe.`,
  };
}

async function collectLiveLoopEnvironment(options: { includeHost: boolean }) {
  const dotnetExecutable = await resolveExecutable("dotnet");
  const host = options.includeHost ? await collectHostContext() : undefined;

  return {
    ok: true,
    workflow: "live_loop_environment",
    policy: "DiagnosticsOnly" satisfies ExecutionPolicy,
    checkedAt: new Date().toISOString(),
    cwd: process.cwd(),
    hostBaseUrl: resolveHostBaseUrl(),
    executables: {
      dotnet: dotnetExecutable,
    },
    host,
    guidance: environmentGuidance(host),
  };
}

async function runHostRefreshSourceRun(request: {
  pollSeconds: number;
  pollIntervalSeconds: number;
}) {
  const startedAt = Date.now();
  const repoRoot = process.cwd();
  const hostCwd = resolve(repoRoot, "source/Pe.Host");
  const child = spawn("dotnet", ["run"], {
    cwd: hostCwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const readiness = await pollHostReachable({
    pollSeconds: request.pollSeconds,
    pollIntervalSeconds: request.pollIntervalSeconds,
  });
  const ok = readiness.ok;
  return {
    ok,
    workflow: "host_refresh_source_run",
    policy: "RrdRequired" satisfies ExecutionPolicy,
    cwd: repoRoot,
    commandLine: `cd source/Pe.Host && dotnet run`,
    processId: child.pid ?? null,
    timedOut: !ok,
    durationMs: Date.now() - startedAt,
    readiness,
    proof: {
      interpretation: ok
        ? "Pe.Host source-run launch was started and Host became reachable after singleton takeover."
        : "Pe.Host source-run launch was started, but Host did not become reachable before polling timed out.",
      proves: ok
        ? "The reachable Host process is responding after a source-run refresh request."
        : "Only proves the source-run process was launched; inspect Host logs for startup/build failures.",
      doesNotProve:
        "Does not prove the Revit bridge is connected or that RRD loaded refreshed in-process assemblies.",
      nextStep: ok
        ? "Use live_loop_context or the target Host/Revit operation to prove bridge/session behavior."
        : "Inspect host logs and rerun with a longer timeout or fix the Host startup failure.",
    },
    guidance:
      "Use this only when intentionally refreshing the dev/source Host lane after Host operation or contract changes; it may build before singleton takeover.",
  };
}

async function pollHostReachable(options: {
  pollSeconds: number;
  pollIntervalSeconds: number;
}) {
  const deadline = Date.now() + options.pollSeconds * 1000;
  let attempts = 0;
  let host: Awaited<ReturnType<typeof collectHostContext>> | undefined;
  do {
    attempts++;
    host = await collectHostContext();
    if (host.reachable)
      return {
        ok: true,
        attempts,
        reason: "Pe.Host responded to probe/session polling.",
        host,
      };

    if (Date.now() >= deadline) break;
    await delay(options.pollIntervalSeconds * 1000);
  } while (options.pollSeconds > 0);

  return {
    ok: false,
    attempts,
    reason: "Timed out before Pe.Host responded to probe/session polling.",
    host,
  };
}

function environmentGuidance(
  host: Awaited<ReturnType<typeof collectHostContext>> | undefined,
): string[] {
  const guidance = [
    "Use source compile/package proof for ordinary source work; use live-loop only when Rider/Revit/Windows session state matters.",
  ];

  if (host && !host.reachable)
    guidance.push(
      "Pe.Host is not reachable. Inspect the live_loop_context log slice before attempting host operations or scripts.",
    );

  const bridgeConnected =
    host?.probe &&
    "bridgeIsConnected" in host.probe &&
    host.probe.bridgeIsConnected;
  if (host?.reachable && !bridgeConnected)
    guidance.push(
      "Host is reachable but the Revit bridge is not connected; AttachedRrd proof is not available until the live session is healthy.",
    );

  return guidance;
}

async function readPeaHostLogTails(
  target: "all" | "host" | "revit",
  tailLineCount: number,
  cursorMode: LogCursorMode,
) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await createPeHostClient(
      resolveHostBaseUrl(),
    ).host.getLogs({
      target: parseHostLogTarget(target),
      tailLineCount,
    });
    const logs = response.files.map((file) => {
      const cursorKey = file.filePath.toLowerCase();
      const storedCursor = logCursorStore.get(cursorKey);
      const previousCursor = cursorMode === "reset" ? undefined : storedCursor;
      const invalidated =
        previousCursor != null && file.lines.length < previousCursor.lineCount;
      const previousLineCount =
        previousCursor == null || invalidated
          ? file.lines.length
          : previousCursor.lineCount;
      const newLines =
        previousCursor == null || invalidated
          ? []
          : file.lines.slice(previousLineCount);
      const nextCursor = {
        checkedAt,
        size: file.lines.join("\n").length,
        lineCount: file.lines.length,
      } satisfies LogCursor;

      logCursorStore.set(cursorKey, nextCursor);
      return {
        label: file.label,
        path: file.filePath,
        exists: true,
        lineCount: file.lines.length,
        cursor: {
          mode: cursorMode,
          previous: storedCursor ?? null,
          current: nextCursor,
          invalidated,
          newLineCountSinceLastCheck: newLines.length,
        },
        tail: file.lines.join("\n"),
        newTail: newLines
          .slice(Math.max(0, newLines.length - tailLineCount))
          .join("\n"),
      };
    });

    return {
      ok: true,
      workflow: "pea_host_logs",
      policy: "DiagnosticsOnly" satisfies ExecutionPolicy,
      checkedAt,
      source: "Pea product host log operation",
      logs,
    };
  } catch (error) {
    return {
      ok: false,
      workflow: "pea_host_logs",
      policy: "DiagnosticsOnly" satisfies ExecutionPolicy,
      checkedAt,
      source: "Pea product host log operation",
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    };
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function parseHostLogTarget(target: "all" | "host" | "revit"): HostLogTarget {
  switch (target) {
    case "host":
      return HostLogTarget.Host;
    case "revit":
      return HostLogTarget.Revit;
    case "all":
      return HostLogTarget.All;
  }
}
