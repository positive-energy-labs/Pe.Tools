import { isThreadLockError } from "./thread-lock.ts";

export interface RuntimeSelectableThread {
  id: string;
  resourceId?: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface RuntimeHarnessThreadSelector<
  _TState extends Record<string, unknown> = Record<string, unknown>,
  TThread extends RuntimeSelectableThread = RuntimeSelectableThread,
> {
  createThread(options?: { title?: string }): Promise<TThread> | TThread;
  getCurrentThreadId(): string | null | undefined;
  listThreads(): Promise<TThread[]> | TThread[];
  switchThread(options: { threadId: string }): Promise<void> | void;
}

export type RuntimeStartupThreadSelection<
  TThread extends RuntimeSelectableThread = RuntimeSelectableThread,
> =
  | {
      status: "selected";
      threadId: string;
      thread: TThread;
      lockedThreadIds: string[];
    }
  | {
      status: "created";
      threadId: string;
      thread: TThread;
      lockedThreadIds: string[];
    };

export interface OpenMostRecentUnlockedRuntimeThreadOptions<
  TThread extends RuntimeSelectableThread = RuntimeSelectableThread,
> {
  createTitle?: string;
  filter?: (thread: TThread) => boolean;
  onThreadOpened?: (
    thread: TThread,
    status: RuntimeStartupThreadSelection<TThread>["status"],
  ) => Promise<void> | void;
}

export async function openMostRecentUnlockedRuntimeThread<
  TState extends Record<string, unknown>,
  TThread extends RuntimeSelectableThread,
>(
  harness: RuntimeHarnessThreadSelector<TState, TThread>,
  options: OpenMostRecentUnlockedRuntimeThreadOptions<TThread> = {},
): Promise<RuntimeStartupThreadSelection<TThread>> {
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
