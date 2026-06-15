import type { Harness } from "@mastra/core/harness";
import { isThreadLockError } from "./thread-lock.ts";

type RuntimeThread = Awaited<ReturnType<Harness<Record<string, unknown>>["listThreads"]>>[number];
type RuntimeHarnessThreadSelector = Pick<
  Harness<Record<string, unknown>>,
  "createThread" | "getCurrentThreadId" | "listThreads" | "switchThread"
>;

export type RuntimeStartupThreadSelection =
  | {
      status: "selected";
      threadId: string;
      thread: RuntimeThread;
      lockedThreadIds: string[];
    }
  | {
      status: "created";
      threadId: string;
      thread: RuntimeThread;
      lockedThreadIds: string[];
    };

export interface OpenMostRecentUnlockedRuntimeThreadOptions {
  createTitle?: string;
  filter?: (thread: RuntimeThread) => boolean;
  onThreadOpened?: (
    thread: RuntimeThread,
    status: RuntimeStartupThreadSelection["status"],
  ) => Promise<void> | void;
}

export async function openMostRecentUnlockedRuntimeThread(
  harness: RuntimeHarnessThreadSelector,
  options: OpenMostRecentUnlockedRuntimeThreadOptions = {},
): Promise<RuntimeStartupThreadSelection> {
  const lockedThreadIds: string[] = [];
  const threads = (await harness.listThreads())
    .filter((thread) => options.filter?.(thread) ?? true)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  for (const thread of threads) {
    try {
      await harness.switchThread({ threadId: thread.id });
      await options.onThreadOpened?.(thread, "selected");
      return { status: "selected", threadId: thread.id, thread, lockedThreadIds };
    } catch (error) {
      if (isThreadLockError(error)) {
        lockedThreadIds.push(thread.id);
        continue;
      }
      throw error;
    }
  }

  const thread = await harness.createThread({ title: options.createTitle });
  const threadId = thread.id || harness.getCurrentThreadId();
  if (!threadId) throw new Error("Harness did not return a created thread id.");

  await options.onThreadOpened?.(thread, "created");
  return { status: "created", threadId, thread, lockedThreadIds };
}
