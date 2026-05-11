import { createMastraCode } from "mastracode";
import { MastraTUI } from "mastracode/tui";
import { createTool } from "@mastra/core/tools";
import z from "zod";
import {
  createPeHostClient,
  resolveHostBaseUrl,
  resolveWorkspaceKey,
} from "./pe-host.js";

export interface PeAgentOptions {
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
}

export async function runPeAgent(options: PeAgentOptions = {}): Promise<void> {
  const hostBaseUrl = resolveHostBaseUrl(options.hostBaseUrl);
  const workspaceKey = resolveWorkspaceKey(options.workspaceKey);
  const hostClient = createPeHostClient(hostBaseUrl);
  const cwd = await resolveAgentWorkspaceRoot(
    hostClient,
    hostBaseUrl,
    workspaceKey,
    options.workspaceRoot,
  );

  const getPeHostStatus = createTool({
    id: "get_pe_host_status",
    description:
      "Read Pe.Host status, including bridge/session and active-document state.",
    inputSchema: z.object({}),
    execute: async () => ({
      probe: await hostClient.host.getProbe(),
      sessionSummary: await hostClient.host.getSessionSummary(),
    }),
  });

  const executeRevitScript = createTool({
    id: "execute_revit_script",
    description:
      "Execute a C# Revit script through Pe.Host /api/scripting/execute. Use inline scriptContent for the quickest POC.",
    inputSchema: z.object({
      scriptContent: z.string().optional(),
      sourceKind: z
        .enum(["InlineSnippet", "WorkspacePath"])
        .default("InlineSnippet"),
      sourcePath: z.string().optional(),
      workspaceKey: z.string().default(workspaceKey),
      sourceName: z.string().default("AgentSnippet.cs"),
    }),
    execute: async (input) => hostClient.scripting.execute(input),
  });

  const { harness, mcpManager, hookManager, authStorage } =
    await createMastraCode({
      cwd,
      extraTools: {
        get_pe_host_status: getPeHostStatus,
        execute_revit_script: executeRevitScript,
      } as any,
      initialState: {
        yolo: true,
        thinkingLevel: "medium",
        smartEditing: true,
        notifications: "system",
      },
    });

  const tui = new MastraTUI({
    harness,
    hookManager,
    authStorage,
    mcpManager,
    appName: "Pe Agent",
    version: "0.17.2",
  });

  tui.run();
}

async function resolveAgentWorkspaceRoot(
  hostClient: ReturnType<typeof createPeHostClient>,
  hostBaseUrl: string,
  workspaceKey: string,
  workspaceRoot?: string,
): Promise<string> {
  const configuredRoot = firstNonBlank(workspaceRoot);
  if (configuredRoot) return configuredRoot;

  try {
    const bootstrap = await hostClient.scripting.bootstrapWorkspace({
      workspaceKey,
      createSampleScript: true,
    });
    return bootstrap.workspaceRootPath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to resolve Pe scripting workspace through Pe.Host at ${hostBaseUrl}: ${detail}`,
    );
  }
}

function firstNonBlank(
  ...values: Array<string | undefined>
): string | undefined {
  return values
    .find((value) => value != null && value.trim().length > 0)
    ?.trim();
}
