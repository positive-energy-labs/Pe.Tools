import type { HarnessThread } from "@mastra/core/harness";
import type { RuntimeWorkbenchSession, WorkbenchAccessLevel } from "./types.ts";

export function readAccessLevel(value: unknown): WorkbenchAccessLevel {
  return value === "read-only" || value === "ask" || value === "trusted" ? value : "trusted";
}

export function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function currentThreadTitle(
  threads: HarnessThread[],
  threadId: string | null | undefined,
): string | undefined {
  const thread = threads.find((entry) => entry.id === threadId);
  return thread ? threadTitle(thread) : undefined;
}

export function threadInfo(thread: HarnessThread, cwd?: string): Record<string, unknown> {
  return {
    threadId: thread.id,
    id: thread.id,
    title: threadTitle(thread),
    cwd,
    updatedAt: iso(thread.updatedAt),
  };
}

export function threadTitle(thread: HarnessThread): string {
  const title = thread.title?.trim();
  return title ? title : shortId(thread.id);
}

export async function switchThread(
  session: RuntimeWorkbenchSession,
  threadId: string,
): Promise<void> {
  if (session.thread.getId() === threadId) return;
  await session.thread.switch({ threadId });
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}
