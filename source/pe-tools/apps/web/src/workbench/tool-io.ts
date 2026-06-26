import { useQuery } from "@tanstack/react-query";
import type { WorkbenchToolCall } from "@pe/agent-contracts";
import { workbenchUrl, type WorkbenchEndpointConfig } from "./config";
import { useWorkbench } from "./provider";

export interface ToolIo {
  rawInput?: unknown;
  rawOutput?: unknown;
  error?: string;
}

/**
 * Heavy rawInput/rawOutput no longer ride the frame stream (that made every frame ~1.2MB and
 * OOM'd the server). They're fetched per tool on demand. TanStack Query owns the cache now:
 * the queryKey includes status so a tool fetched while "running" re-fetches once complete, and
 * completed I/O (immutable) is cached for the session via a long staleTime.
 *
 * DEFERRED (fetch storm): one query fires per mounted tool card, so opening Trace/World on a
 * tool-heavy thread still fans out one request per visible tool. Query dedupes identical keys
 * but does not bound concurrency. If it bites: fetch only the focal/visible card(s), or batch
 * into one request. See loadToolIo in packages/runtime/src/workbench/tool-io.ts for server cost.
 */
export function useToolIo(call: WorkbenchToolCall): ToolIo | undefined {
  const { config, currentThreadId } = useWorkbench();
  const status = call.status ?? "running";
  const { data } = useQuery({
    queryKey: ["workbench", "tool-io", currentThreadId, call.id, status],
    queryFn: () => fetchToolIo(config, currentThreadId, call.id),
    enabled: Boolean(currentThreadId),
    staleTime: status === "running" ? 0 : Infinity, // completed I/O is immutable
    gcTime: Infinity,
  });
  return data ?? undefined;
}

async function fetchToolIo(
  config: WorkbenchEndpointConfig,
  threadId: string,
  id: string,
): Promise<ToolIo | null> {
  try {
    const response = await fetch(workbenchUrl(config, "/workbench/tool", { threadId, id }), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const tool = (await response.json())?.tool;
    return tool ? { rawInput: tool.rawInput, rawOutput: tool.rawOutput, error: tool.error } : null;
  } catch {
    return null;
  }
}
