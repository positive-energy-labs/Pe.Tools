import { readFile } from "node:fs/promises";
import z from "zod";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import { HostRpcCaller } from "./host-rpc-caller.js";

const bridgeSessionIdInputSchema = z
  .string()
  .optional()
  .describe("Optional TS host bridge session id to target a specific connected Revit process.");

// Defaults live in the C# request DTO (ExecuteRevitScriptRequest) — this layer passes values
// through untouched so there is exactly one source of truth for scripting semantics.
export const scriptExecuteInputSchema = z.object({
  scriptContent: z
    .string()
    .optional()
    .describe(
      'Trusted in-process C# snippet. Prefer Execute-body statements such as WriteLine("..."); optional leading using directives are allowed. A full public sealed class deriving PeScriptContainer with public override void Execute() is also allowed. Mutually exclusive with sourcePath.',
    ),
  sourcePath: z
    .string()
    .optional()
    .describe(
      "Workspace-relative .cs path of a pod entrypoint declared in pod.json, for example src/SampleScript.cs. Mutually exclusive with scriptContent.",
    ),
  workspaceKey: z
    .string()
    .optional()
    .describe("Pe scripting workspace (pod) key. Defaults to the runtime workspace."),
  sourceName: z
    .string()
    .optional()
    .describe("Synthetic source filename used for inline trace files and compile diagnostics."),
  permissionMode: z
    .enum(["ReadOnly", "WriteTransaction", "NoTransaction"])
    .optional()
    .describe(
      "Host default is ReadOnly: changes are discarded. Use WriteTransaction for document edits. Use NoTransaction only for APIs such as Document.SaveAs that reject an open transaction; it has no rollback guard.",
    ),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(3600)
    .optional()
    .describe(
      "Cooperative execution timeout (host default 600s). Scripts must check ct / ThrowIfCancelled() to be interruptible.",
    ),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptBootstrapInputSchema = z.object({
  workspaceKey: z
    .string()
    .optional()
    .describe("Pe scripting workspace (pod) key. Defaults to the runtime workspace."),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptCancelInputSchema = z.object({
  executionId: z
    .string()
    .optional()
    .describe("Optional execution id guard; omit to cancel whatever script is currently running."),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptPodListInputSchema = z.object({
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export const scriptPodImportInputSchema = z.object({
  archivePath: z
    .string()
    .describe("Absolute or process-relative path to the Pod .zip archive to import."),
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
  archivePath: z.string().describe("Output path for the exported Pod .zip archive."),
  bridgeSessionId: bridgeSessionIdInputSchema,
});

export type ScriptRuntimeContext = HostSessionScope & {
  hostBaseUrl: string;
  workspaceKey: string;
  timeoutSeconds?: number;
};

export type ScriptExecuteInput = z.input<typeof scriptExecuteInputSchema>;
export type ScriptBootstrapInput = z.input<typeof scriptBootstrapInputSchema>;
export type ScriptCancelInput = z.input<typeof scriptCancelInputSchema>;
export type ScriptPodListInput = z.input<typeof scriptPodListInputSchema>;
export type ScriptPodImportInput = z.input<typeof scriptPodImportInputSchema>;
export type ScriptPodExportInput = z.input<typeof scriptPodExportInputSchema>;

export class ScriptingTools {
  constructor(
    private readonly client: HostRpcCaller,
    private readonly context: Pick<ScriptRuntimeContext, "workspaceKey">,
  ) {}

  execute(input: ScriptExecuteInput) {
    if (input.scriptContent != null && input.sourcePath != null)
      throw new Error(
        "Provide either scriptContent (inline C#) or sourcePath (a pod entrypoint under src/), not both.",
      );

    // Omit nullish optional keys: the effect NDJSON RPC layer rejects an explicit `undefined`
    // field value (fails at ["request"]) rather than treating the key as absent.
    // Freshness and lifecycle are explicit SDK control-plane actions. Script execution must never
    // build, converge, or restart a Revit session as a hidden precondition.
    return this.client.call("scripting.execute", {
      ...(input.scriptContent != null ? { scriptContent: input.scriptContent } : {}),
      ...(input.sourcePath != null ? { sourcePath: input.sourcePath } : {}),
      workspaceKey: input.workspaceKey ?? this.context.workspaceKey,
      ...(input.sourceName != null ? { sourceName: input.sourceName } : {}),
      ...(input.permissionMode != null ? { permissionMode: input.permissionMode } : {}),
      ...(input.timeoutSeconds != null ? { timeoutSeconds: input.timeoutSeconds } : {}),
    });
  }

  cancel(input: ScriptCancelInput = {}) {
    return this.client.call(
      "scripting.cancel",
      input.executionId != null ? { executionId: input.executionId } : {},
    );
  }

  bootstrap(input: ScriptBootstrapInput) {
    return this.client.call("scripting.workspace.bootstrap", {
      workspaceKey: input.workspaceKey ?? this.context.workspaceKey,
    });
  }

  listPods() {
    return this.client.call("scripting.pod.list", {});
  }

  importPod(input: ScriptPodImportInput) {
    return this.client.call("scripting.pod.import", {
      archivePath: input.archivePath,
      ...(input.workspaceKey != null ? { workspaceKey: input.workspaceKey } : {}),
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

/** Client-side RPC timeout wide enough for the host's admission wait + execution timeout. */
export function scriptClientTimeoutMs(timeoutSeconds: number | undefined): number {
  return ((timeoutSeconds ?? 600) + 90) * 1000;
}

/**
 * Shared CLI content sourcing: exactly one of --script-content, --file, or --stdin.
 * Ambiguous combinations are an error, not a silent precedence.
 */
export async function resolveCliScriptContent(values: {
  scriptContent?: unknown;
  file?: unknown;
  stdin?: unknown;
}): Promise<string | undefined> {
  const explicit = asNonBlankString(values.scriptContent);
  const file = asNonBlankString(values.file);
  const stdin = values.stdin === true;
  const sourceCount = [explicit, file, stdin ? "stdin" : undefined].filter(Boolean).length;
  if (sourceCount > 1) throw new Error("Provide only one of --script-content, --file, or --stdin.");

  if (explicit) return explicit;
  if (file) return readFile(file, "utf-8");
  if (stdin) return readCliStdin();
  return undefined;
}

export function parseCliPermissionMode(
  value: unknown,
): "ReadOnly" | "WriteTransaction" | "NoTransaction" | undefined {
  const text = asNonBlankString(value);
  if (!text) return undefined;
  switch (text) {
    case "ReadOnly":
      return "ReadOnly";
    case "WriteTransaction":
      return "WriteTransaction";
    case "NoTransaction":
      return "NoTransaction";
    default:
      throw new Error(
        "Unknown permission mode. Expected ReadOnly, WriteTransaction, or NoTransaction.",
      );
  }
}

function asNonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readCliStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      content += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(content));
  });
}

function createScriptingClient(context: ScriptRuntimeContext): HostRpcCaller {
  return new HostRpcCaller({
    hostBaseUrl: context.hostBaseUrl,
    bridgeSessionId: context.bridgeSessionId,
    timeoutMs: scriptClientTimeoutMs(context.timeoutSeconds),
  });
}
