import { useEffect, useState } from "react";
import type { WorkbenchToolCall } from "@pe/agent-contracts";
import { workbenchUrl, type WorkbenchEndpointConfig } from "./config.ts";
import { useWorkbench } from "./WorkbenchProvider.tsx";

export interface ToolIo {
  rawInput?: unknown;
  rawOutput?: unknown;
  error?: string;
}

/**
 * The heavy rawInput/rawOutput no longer ride the frame stream (that made every frame ~1.2MB and
 * OOM'd the server). They're fetched per tool on demand and cached. Key includes status so a tool
 * fetched while "running" is re-fetched once it completes; completed I/O is immutable, so each
 * finished tool is fetched exactly once for the whole session — decoupled from the stream.
 * ponytail: live partial tool output no longer streams to the trace lane; the card fills on
 * completion. That live streaming is exactly what we're removing — re-add a poll only if it bites.
 *
 * DEFERRED (fetch storm): one fetch fires per mounted tool card, so opening Trace/World view on a
 * tool-heavy thread fans out one request per tool at once (measured ~460 concurrent on a 460-tool
 * thread, 2026-06-26), and each hits a server endpoint that re-scans the whole thread — see
 * loadToolIo in packages/runtime/src/workbench/tool-io.ts for the server cost + fix options.
 * Client-side fixes (deferred): fetch only the focal/visible card(s); drop `status` from the cache
 * key so each tool is fetched once ever; or batch into one request.
 */
// TODO: replace with TanStack Query or remove when a frame diff/merge approach is chosen.
const cache = new Map<string, Promise<ToolIo | null>>();

export function useToolIo(call: WorkbenchToolCall): ToolIo | undefined {
  const { config, currentThreadId } = useWorkbench();
  const [io, setIo] = useState<ToolIo | undefined>(undefined);
  const status = call.status ?? "running";
  useEffect(() => {
    let active = true;
    const key = `${currentThreadId}:${call.id}:${status}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchToolIo(config, currentThreadId, call.id);
      cache.set(key, pending);
    }
    void pending.then((value) => {
      if (active && value) setIo(value);
    });
    return () => {
      active = false;
    };
  }, [config, currentThreadId, call.id, status]);
  return io;
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
