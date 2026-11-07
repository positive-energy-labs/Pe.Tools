import type { Reading } from "@pe/agent-contracts";
import type { ChatHandle } from "./route.ts";
export type { ChatHandle } from "./route.ts";

/** Drawing projection only. Both fields come from the one host context Value. */
export function chatReading<T = unknown>(owner: ChatHandle, id: "machine" | "capabilities"): Reading<T> {
  const state = owner.value, value = state.value?.[id] as T | undefined;
  if (state.current && value !== undefined) return { state: "ready", observation: value };
  if (state.status === "failed") return { state: "failed", message: state.reason, previous: value };
  return value === undefined ? { state: "absent" } : { state: "stale", previous: value, reason: "dirtied" };
}
