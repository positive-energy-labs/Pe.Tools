import type { Session } from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";
import type { ScopeStore } from "./scope-store.ts";

type Input = Parameters<Session["sendMessage"]>[0];
type QueueItem = {
  id: string;
  head: Awaited<ReturnType<ScopeStore["read"]>>;
  input: Input;
};
export const turnQueues = new WeakMap<
  Session,
  {
    read: () => {
      items: { id: string; content: string; attachments: number }[];
      paused: boolean;
      error?: string;
    };
    change: (
      command:
        | { action: "resume" }
        | { action: "remove"; id: string }
        | { action: "edit"; id: string; content: string },
    ) => Promise<void>;
  }
>();

/** Pea's `items` is the only queue; Mastra's `followUps` stays empty. Every item dispatches
 *  through Pea's ordinary admission, which refuses it when the thread target moved. */
export function installTurnQueue(session: Session, scopes: ScopeStore) {
  const send = session.sendMessage.bind(session);
  let completed = false;
  let busy = session.run.isRunning();
  let error: string | undefined;
  const items = new Map<string, QueueItem>();
  let tail = Promise.resolve();
  const publish = () => session.emit({ type: "follow_up_queued", count: items.size });
  const clear = () => {
    items.clear();
    error = undefined;
  };
  // Mastra resets its thread display (and its own follow-ups) on these; Pea's queue follows.
  const off = session.subscribe((event) => {
    if (event.type === "agent_start") busy = true;
    if (event.type === "agent_end") {
      busy = false;
      completed = event.reason === "complete";
    }
    if (event.type === "thread_changed" || event.type === "thread_created") clear();
    if (event.type === "thread_deleted" && !session.thread.getId()) clear();
  });
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  session.sendMessage = (input) =>
    serialized(async () => {
      if (
        !items.size &&
        ((!busy && !session.run.isRunning()) || session.suspensions.hasPending())
      ) {
        busy = true;
        try {
          await send(input);
        } catch (error) {
          busy = false;
          throw error;
        }
        return;
      }
      const head = await scopes.read(session.thread.requireId());
      const item = { id: crypto.randomUUID(), head, input };
      items.set(item.id, item);
      publish();
    });
  session.followUp = (input) => session.sendMessage(input);
  const steer = session.steer.bind(session);
  session.steer = async (input) => {
    clear();
    publish();
    return steer(input);
  };
  session.drainFollowUpQueue = () => {
    // Abort teardown itself awaits this hook; never wait behind the send awaiting that teardown.
    if (!completed || busy || session.run.isRunning()) return Promise.resolve(false);
    return serialized(async () => {
      if (!completed || busy || session.run.isRunning()) return false;
      const [next] = items.values();
      if (!next) return false;
      completed = false;
      try {
        busy = true;
        const requestContext = next.input.requestContext ?? new RequestContext();
        requestContext.set("peaQueuedHead", next.head);
        await send({ ...next.input, requestContext });
        items.delete(next.id);
        error = undefined;
        publish();
        return true;
      } catch (caught) {
        busy = false;
        error = caught instanceof Error ? caught.message : String(caught);
        publish();
        session.emit({
          type: "error",
          error: new Error(error),
          errorType: "queued-message",
        });
        return false;
      }
    });
  };
  turnQueues.set(session, {
    read: () => ({
      items: [...items.values()].map(({ id, input }) => ({
        id,
        content: input.content,
        attachments: input.files?.length ?? 0,
      })),
      paused: !busy && items.size > 0 && !completed,
      error,
    }),
    change: async (command) => {
      await serialized(async () => {
        if (command.action === "resume") {
          if (busy || session.run.isRunning()) throw new Error("Pea is still working.");
          // Resuming approves the thread's current target for everything still queued.
          const head = await scopes.read(session.thread.requireId());
          for (const item of items.values()) item.head = head;
          error = undefined;
          completed = true;
          return;
        }
        const item = items.get(command.id);
        if (!item) throw new Error("That message has already left the queue.");
        if (command.action === "edit") {
          item.input = { ...item.input, content: command.content };
          item.head = await scopes.read(session.thread.requireId());
        } else items.delete(command.id);
        if (!items.size) error = undefined;
        publish();
      });
      if (command.action === "resume") await session.drainFollowUpQueue();
    },
  });
  return () => {
    off();
    turnQueues.delete(session);
  };
}
