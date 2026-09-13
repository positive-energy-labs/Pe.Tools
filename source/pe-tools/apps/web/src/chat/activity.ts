import { selectToolCalls, type ChatState } from "#/workbench/chat-state";
import { actionReceiptId } from "#/workbench/route-chat-plugins/receipt-id";

export interface ChatActivityRow {
  readonly id: string;
  readonly key: string;
  readonly state: string;
  readonly says: string;
  readonly tone: "caution" | "meta";
}

function resultRow(result: unknown): Record<string, unknown> | undefined {
  const raw =
    result && typeof result === "object" && "structuredContent" in result
      ? (result as { structuredContent: unknown }).structuredContent
      : result;
  const outer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const inner = outer?.result;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : outer;
}

/**
 * Every original operation this thread started that has not reached a terminal outcome, plus the
 * turn's in-flight calls. Derived during render from the thread's tool projection; a later
 * successful call appends to this list and can never remove an earlier unknown one.
 */
export function unresolvedRuns(chat: ChatState): ChatActivityRow[] {
  const rows: ChatActivityRow[] = [];
  for (const call of selectToolCalls(chat)) {
    if (call.title !== "pe_do" && call.title !== "pe_read") continue;
    const result = call.status === "completed" ? call.result : undefined;
    const id = actionReceiptId(call.args, result);
    if (!id) continue;
    const row = resultRow(result);
    const state = typeof row?.state === "string" ? row.state : undefined;
    if (call.status === "completed" && (state === "succeeded" || state === "failed")) continue;
    const key =
      (typeof row?.key === "string" ? row.key : undefined) ??
      (call.args && typeof call.args === "object" && "key" in call.args
        ? String((call.args as { key: unknown }).key)
        : call.title);
    rows.push({
      id,
      key,
      state: state ?? (call.status === "in_progress" ? "running" : (call.status ?? "unknown")),
      says:
        call.status === "in_progress"
          ? `action ${id} — still running in this turn; no outcome has been read yet`
          : call.status === "failed"
            ? `action ${id} — the call ended without a terminal outcome, so its status is unknown. This is not proof the operation failed.`
            : state === "unknown"
              ? `action ${id} — its outcome could not be determined. This is not proof the operation failed; read the original receipt.`
              : `action ${id} — recorded ${state ?? "without a terminal state"}; still unresolved`,
      tone: "caution",
    });
  }
  return rows;
}
