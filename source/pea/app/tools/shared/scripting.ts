import z from "zod";
import {
  PeHostClient,
  ScriptExecutionSourceKind,
  ScriptPermissionMode,
} from "../../host-client.js";

export const scriptExecuteInputSchema = z.object({
  scriptContent: z
    .string()
    .optional()
    .describe(
      "InlineSnippet content. By default, provide Execute-body statements such as WriteLine(\"...\"); a full public sealed class deriving PeScriptContainer with public override void Execute() is also allowed.",
    ),
  sourceKind: z
    .enum(["InlineSnippet", "WorkspacePath"])
    .default("InlineSnippet")
    .describe(
      "Where source comes from: InlineSnippet uses scriptContent; WorkspacePath uses sourcePath under the selected workspace.",
    ),
  sourcePath: z
    .string()
    .optional()
    .describe("Workspace-relative .cs path for WorkspacePath mode, for example src/SampleScript.cs."),
  workspaceKey: z
    .string()
    .optional()
    .describe("Pe scripting workspace key. Defaults to the runtime workspace."),
  sourceName: z
    .string()
    .default("AgentSnippet.cs")
    .describe("Synthetic source filename used for inline trace files and compile diagnostics."),
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

export const scriptPodImportInputSchema = z.object({
  archivePath: z
    .string()
    .describe("Absolute or process-relative path to the Pod zip archive to import."),
  workspaceKey: z
    .string()
    .optional()
    .describe("Optional target workspace slug. Omit to use the pod.json id."),
});

export const scriptPodExportInputSchema = z.object({
  workspaceKey: z
    .string()
    .optional()
    .describe("Pod workspace slug to export. Defaults to the runtime workspace."),
  archivePath: z
    .string()
    .describe("Output path for the exported Pod zip archive."),
});

export interface ScriptRuntimeContext {
  hostBaseUrl: string;
  workspaceKey: string;
  timeoutSeconds?: number;
}

export type ScriptExecuteInput = z.input<typeof scriptExecuteInputSchema>;
export type ScriptBootstrapInput = z.input<typeof scriptBootstrapInputSchema>;
export type ScriptPodImportInput = z.input<typeof scriptPodImportInputSchema>;
export type ScriptPodExportInput = z.input<typeof scriptPodExportInputSchema>;

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

export function importScriptPod(
  input: ScriptPodImportInput,
  context: ScriptRuntimeContext,
) {
  return createScriptingClient(context).scripting.importPod({
    archivePath: input.archivePath,
    workspaceKey: input.workspaceKey,
  });
}

export function exportScriptPod(
  input: ScriptPodExportInput,
  context: ScriptRuntimeContext,
) {
  return createScriptingClient(context).scripting.exportPod({
    workspaceKey: input.workspaceKey ?? context.workspaceKey,
    archivePath: input.archivePath,
  });
}

function createScriptingClient(context: ScriptRuntimeContext): PeHostClient {
  return new PeHostClient({
    baseUrl: context.hostBaseUrl,
    timeoutMs: Math.max(context.timeoutSeconds ?? 300, 1) * 1000,
  });
}
