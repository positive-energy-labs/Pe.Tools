import z from "zod";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "./host-rpc-caller.js";

const bridgeSessionIdInputSchema = z
  .string()
  .optional()
  .describe("Optional TS host bridge session id to target a specific connected Revit process.");

export const scriptExecuteInputSchema = z.object({
  scriptContent: z
    .string()
    .optional()
    .describe(
      'InlineSnippet content. Prefer Execute-body statements such as WriteLine("..."); optional leading using directives are allowed. A full public sealed class deriving PeScriptContainer with public override void Execute() is also allowed. WorkspacePath scripts should be normal C# files with one PeScriptContainer.',
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
    .describe(
      "Workspace-relative .cs path for WorkspacePath mode, for example src/SampleScript.cs.",
    ),
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
  bridgeSessionId: bridgeSessionIdInputSchema,
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
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptPodImportInputSchema = z.object({
  archivePath: z
    .string()
    .describe("Absolute or process-relative path to the Pod zip archive to import."),
  workspaceKey: z
    .string()
    .optional()
    .describe("Optional target workspace slug. Omit to use the pod.json id."),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptPodExportInputSchema = z.object({
  workspaceKey: z
    .string()
    .optional()
    .describe("Pod workspace slug to export. Defaults to the runtime workspace."),
  archivePath: z.string().describe("Output path for the exported Pod zip archive."),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export type ScriptRuntimeContext = HostSessionScope & {
  hostBaseUrl: string;
  workspaceKey: string;
  timeoutSeconds?: number;
};

export type ScriptExecuteInput = z.input<typeof scriptExecuteInputSchema>;
export type ScriptBootstrapInput = z.input<typeof scriptBootstrapInputSchema>;
export type ScriptPodImportInput = z.input<typeof scriptPodImportInputSchema>;
export type ScriptPodExportInput = z.input<typeof scriptPodExportInputSchema>;

export class ScriptingTools {
  constructor(
    private readonly client: HostRpcCaller,
    private readonly context: Pick<ScriptRuntimeContext, "workspaceKey">,
  ) {}

  execute(input: ScriptExecuteInput) {
    return this.client.call("scripting.execute", {
      scriptContent: input.scriptContent,
      sourceKind:
        (input.sourceKind ?? "InlineSnippet") === "WorkspacePath"
          ? "WorkspacePath"
          : "InlineSnippet",
      sourcePath: input.sourcePath,
      workspaceKey: input.workspaceKey ?? this.context.workspaceKey,
      sourceName: input.sourceName ?? "AgentSnippet.cs",
      permissionMode: input.permissionMode === "WriteTransaction" ? "WriteTransaction" : "ReadOnly",
    });
  }

  bootstrap(input: ScriptBootstrapInput) {
    return this.client.call("scripting.workspace.bootstrap", {
      workspaceKey: input.workspaceKey ?? this.context.workspaceKey,
      createSampleScript: input.createSampleScript ?? true,
    });
  }

  importPod(input: ScriptPodImportInput) {
    return this.client.call("scripting.pod.import", {
      archivePath: input.archivePath,
      workspaceKey: input.workspaceKey,
    });
  }

  exportPod(input: ScriptPodExportInput) {
    return this.client.call("scripting.pod.export", {
      workspaceKey: input.workspaceKey ?? this.context.workspaceKey,
      archivePath: input.archivePath,
    });
  }

  static fromContext(context: ScriptRuntimeContext): ScriptingTools {
    return new ScriptingTools(createScriptingClient(context), {
      workspaceKey: context.workspaceKey,
    });
  }
}

export function executeScriptViaHost(input: ScriptExecuteInput, context: ScriptRuntimeContext) {
  return ScriptingTools.fromContext(context).execute(input);
}

export function bootstrapScriptWorkspace(
  input: ScriptBootstrapInput,
  context: ScriptRuntimeContext,
) {
  return ScriptingTools.fromContext(context).bootstrap(input);
}

export function importScriptPod(input: ScriptPodImportInput, context: ScriptRuntimeContext) {
  return ScriptingTools.fromContext(context).importPod(input);
}

export function exportScriptPod(input: ScriptPodExportInput, context: ScriptRuntimeContext) {
  return ScriptingTools.fromContext(context).exportPod(input);
}

function createScriptingClient(context: ScriptRuntimeContext): HostRpcCaller {
  return new HostRpcCaller({
    hostBaseUrl: context.hostBaseUrl,
    bridgeSessionId: context.bridgeSessionId,
    timeoutMs: Math.max(context.timeoutSeconds ?? 300, 1) * 1000,
  });
}
