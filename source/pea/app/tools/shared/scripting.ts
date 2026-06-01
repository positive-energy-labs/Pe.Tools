import z from "zod";
import {
  PeHostClient,
  ScriptExecutionSourceKind,
  ScriptPermissionMode,
} from "../../host-client.js";

export const scriptExecuteInputSchema = z.object({
  scriptContent: z.string().optional(),
  sourceKind: z.enum(["InlineSnippet", "WorkspacePath"]).default("InlineSnippet"),
  sourcePath: z.string().optional(),
  workspaceKey: z
    .string()
    .optional()
    .describe("Pe scripting workspace key. Defaults to the runtime workspace."),
  sourceName: z.string().default("AgentSnippet.cs"),
  permissionMode: z
    .enum(["ReadOnly", "WriteTransaction"])
    .default("ReadOnly")
    .describe(
      "Defaults to ReadOnly. Use WriteTransaction only for explicit mutations; the host owns the transaction.",
    ),
});

export const scriptBootstrapInputSchema = z.object({
  workspaceKey: z
    .string()
    .optional()
    .describe("Pe scripting workspace key. Defaults to the runtime workspace."),
  createSampleScript: z
    .boolean()
    .default(true)
    .describe("Create the sample script file when it does not already exist."),
});

export interface ScriptRuntimeContext {
  hostBaseUrl: string;
  workspaceKey: string;
  timeoutSeconds?: number;
}

export type ScriptExecuteInput = z.input<typeof scriptExecuteInputSchema>;
export type ScriptBootstrapInput = z.input<typeof scriptBootstrapInputSchema>;

export function executeScriptViaHost(
  input: ScriptExecuteInput,
  context: ScriptRuntimeContext,
): Promise<unknown> {
  return createScriptingClient(context).scripting.execute({
    scriptContent: input.scriptContent,
    sourceKind:
      (input.sourceKind ?? "InlineSnippet") === "WorkspacePath"
        ? ScriptExecutionSourceKind.WorkspacePath
        : ScriptExecutionSourceKind.InlineSnippet,
    sourcePath: input.sourcePath,
    workspaceKey: input.workspaceKey ?? context.workspaceKey,
    sourceName: input.sourceName ?? "AgentSnippet.cs",
    permissionMode:
      input.permissionMode === "WriteTransaction"
        ? ScriptPermissionMode.WriteTransaction
        : ScriptPermissionMode.ReadOnly,
  });
}

export function bootstrapScriptWorkspace(
  input: ScriptBootstrapInput,
  context: ScriptRuntimeContext,
) {
  return createScriptingClient(context).scripting.bootstrapWorkspace({
    workspaceKey: input.workspaceKey ?? context.workspaceKey,
    createSampleScript: input.createSampleScript ?? true,
  });
}

function createScriptingClient(context: ScriptRuntimeContext): PeHostClient {
  return new PeHostClient({
    baseUrl: context.hostBaseUrl,
    timeoutMs: Math.max(context.timeoutSeconds ?? 300, 1) * 1000,
  });
}
