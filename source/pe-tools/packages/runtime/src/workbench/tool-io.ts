import { collectWorkbenchTools, mergeCurrentMessage } from "./projection.ts";
import { readString } from "./shared.ts";
import type { WorkbenchContext } from "./types.ts";

/**
 * Full raw I/O for one tool call, loaded on demand instead of riding every state frame.
 *
 * DEFERRED (fetch storm): this is O(thread) per call — it re-lists ALL messages and rebuilds
 * the WHOLE tool set just to extract one tool's I/O. The web trace lane mounts one card per tool
 * and each fetches here, so opening Trace/World view on a tool-heavy thread fans out one request
 * per tool, each doing a full-thread scan. Measured 2026-06-26 on a 460-tool thread: a burst of
 * ~460 concurrent fetches, ~30-65ms each → O(tools × thread-size). NOT triggered by a normal send
 * (Chat view mounts no trace cards); only on entering Trace/World or reloading there.
 * Fix options (deferred): (a) memoize the tool map per (threadId, message-count) so a burst shares
 * ONE scan; (b) client fetches only the focal/visible card(s) instead of all; (c) batch endpoint
 * GET /workbench/tools?ids=. See client useToolIo in apps/website/src/workbench/tool-io.ts.
 */
export async function loadToolIo(
  context: WorkbenchContext,
  threadId: string | undefined,
  id: string,
): Promise<Record<string, unknown> | null> {
  const session = context.session;
  const effectiveThreadId = threadId ?? session.thread.getId();
  const messages = effectiveThreadId
    ? await session.thread.listMessages({ threadId: effectiveThreadId })
    : [];
  const displayState =
    effectiveThreadId === session.thread.getId() ? session.displayState.get() : undefined;
  const merged = displayState ? mergeCurrentMessage(messages, displayState) : messages;
  const tool = collectWorkbenchTools(merged, displayState).find(
    (call) => readString(call.id) === id,
  );
  if (!tool) return null;
  return { id, rawInput: tool.rawInput, rawOutput: tool.rawOutput, error: tool.error };
}
