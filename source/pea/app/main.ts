import { createMastraCode } from "mastracode";
import { MastraTUI } from "mastracode/tui";
import { createTool } from "@mastra/core/tools";
import z from "zod";

const hostBaseUrl = process.env.PE_HOST_URL ?? "http://localhost:17847";
const workspaceKey = process.env.PE_SCRIPT_WORKSPACE ?? "agent-poc";
const cwd =
  process.env.PE_SCRIPT_WORKSPACE_ROOT ??
  "C:\\Users\\kaitp\\OneDrive\\Documents\\Pe.Scripting\\workspace\\agent-poc";

async function postHost<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(`${hostBaseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const bootstrapRevitScriptWorkspace = createTool({
  id: "bootstrap_revit_script_workspace",
  description:
    "Create/update the Pe.Revit scripting workspace through Pe.Host and return the generated file paths.",
  inputSchema: z.object({
    workspaceKey: z.string().default(workspaceKey),
    createSampleScript: z.boolean().default(true),
  }),
  execute: async (input) =>
    postHost("/api/scripting/workspace/bootstrap", input),
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
    projectContent: z.string().optional(),
    sourceName: z.string().default("AgentSnippet.cs"),
  }),
  execute: async (input) => postHost("/api/scripting/execute", input),
});

const { harness, mcpManager, hookManager, authStorage } =
  await createMastraCode({
    cwd,
    extraTools: {
      bootstrap_revit_script_workspace: bootstrapRevitScriptWorkspace,
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
  appName: "Revit Agent POC",
  version: "0.17.2",
});

tui.run();
