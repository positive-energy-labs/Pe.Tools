import type { WorkbenchToolCall } from "@pe/agent-contracts";

export interface ToolIo {
  rawInput?: unknown;
  rawOutput?: unknown;
  error?: string;
}

/**
 * Tool raw I/O reader. Under the native agent-controller the client reduces `tool_start`/`tool_end`
 * (and the persisted message tool_call/tool_result parts) into the tool call itself, so rawInput /
 * rawOutput already live on `WorkbenchToolCall` — no on-demand `/workbench/tool` fetch is needed.
 * Kept as a hook so the Lens trace card call site is unchanged.
 */
export function useToolIo(call: WorkbenchToolCall): ToolIo | undefined {
  return { rawInput: call.rawInput, rawOutput: call.rawOutput, error: call.error };
}
