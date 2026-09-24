import type { Session } from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";
import type { ScopeStore, StoredTurn } from "./scope-store.ts";

type Input = Parameters<Session["sendMessage"]>[0];
type QueueItem = { id: string; head: StoredTurn["head"]; input: Input; dispatching: boolean };
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

const ambiguous =
  "The host stopped while sending this message, so Pea may already have received it. Resume to send it again, or remove it.";

/** Pea's `items` is the only queue; Mastra's `followUps` stays empty. The queue persists beside
 *  the thread head, and every item dispatches through Pea's ordinary admission, which refuses it
 *  when the thread target moved. A cancel, a failed dispatch, or a restart holds the queue until
 *  resume; a fresh Enter still sends. */
export function installTurnQueue(session: Session, scopes: ScopeStore) {
  const send = session.sendMessage.bind(session);
  let completed = false;
  let held = false;
  let busy = session.run.isRunning();
  let error: string | undefined;
  let owner = session.thread.getId();
  const items = new Map<string, QueueItem>();
  const steered = new WeakSet<object>();
  let tail = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const publish = () => session.emit({ type: "follow_up_queued", count: items.size });
  const save = (list = [...items.values()]) =>
    owner
      ? scopes.writeQueue(
          owner,
          list.map(({ id, head, input, dispatching }) => ({
            id,
            head,
            content: input.content,
            files: input.files,
            dispatching,
          })),
        )
      : Promise.resolve();
  const commit = async () => {
    if (!items.size) {
      held = false;
      error = undefined;
    }
    await save();
    publish();
  };
  const reset = (thread: string | null) => {
    owner = thread;
    items.clear();
    held = false;
    error = undefined;
  };
  // Nothing is running to drain a restored queue, so it waits for resume; an item that was
  // mid-admission when the host stopped says so and is never replayed on its own.
  const load = () =>
    serialized(async () => {
      if (!owner) return;
      const thread = owner;
      try {
        for (const { id, head, content, files, dispatching } of await scopes.readQueue(thread))
          items.set(id, { id, head, input: { content, files }, dispatching });
      } catch (caught) {
        error = `Queued messages could not be restored: ${caught instanceof Error ? caught.message : String(caught)}`;
      }
      held = items.size > 0;
      if ([...items.values()].some((item) => item.dispatching)) error = ambiguous;
      publish();
    });
  const ready = load();
  // Mastra resets its thread display (and its own follow-ups) on these; Pea's queue follows.
  const off = session.subscribe((event) => {
    if (event.type === "agent_start") busy = true;
    if (event.type === "agent_end") {
      busy = false;
      completed = event.reason === "complete";
      if (items.size && (event.reason === "aborted" || event.reason === "error")) held = true;
    }
    if (event.type === "thread_changed" || event.type === "thread_created") {
      reset(event.type === "thread_changed" ? event.threadId : event.thread.id);
      void load();
    }
    if (event.type === "thread_deleted") {
      void scopes.writeQueue(event.threadId, []).catch(() => undefined);
      if (!session.thread.getId()) reset(null);
    }
  });
  session.sendMessage = (input) =>
    serialized(async () => {
      const steering = input.requestContext !== undefined && steered.delete(input.requestContext);
      // A fresh Enter over a held queue is a new intent: it sends, and the held items stay held.
      if (
        steering ||
        ((!items.size || held) &&
          ((!busy && !session.run.isRunning()) || session.suspensions.hasPending()))
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
      const item = { id: crypto.randomUUID(), head, input, dispatching: false };
      await save([...items.values(), item]);
      items.set(item.id, item);
      publish();
    });
  session.followUp = (input) => session.sendMessage(input);
  // Mastra's steer aborts, then sends through `sendMessage`; that send never waits behind the
  // run it just cancelled (Mastra's own admission waits out the abort).
  const steer = session.steer.bind(session);
  session.steer = async (input) => {
    await serialized(async () => {
      items.clear();
      await commit();
    });
    const requestContext = input.requestContext ?? new RequestContext();
    steered.add(requestContext);
    return steer({ ...input, requestContext });
  };
  const drainable = () => completed && !held && !busy && !session.run.isRunning();
  session.drainFollowUpQueue = () => {
    // Abort teardown itself awaits this hook; never wait behind the send awaiting that teardown.
    if (!drainable()) return Promise.resolve(false);
    return serialized(async () => {
      if (!drainable()) return false;
      const [next] = items.values();
      if (!next) return false;
      completed = false;
      busy = true;
      try {
        next.dispatching = true;
        await save();
        const requestContext = next.input.requestContext ?? new RequestContext();
        requestContext.set("peaQueuedHead", next.head);
        requestContext.set("peaQueuedId", next.id);
        await send({ ...next.input, requestContext });
      } catch (caught) {
        busy = false;
        held = true;
        next.dispatching = false;
        error = caught instanceof Error ? caught.message : String(caught);
        await commit().catch(() => undefined);
        session.emit({
          type: "error",
          error: new Error(error),
          errorType: "queued-message",
        });
        return false;
      }
      items.delete(next.id);
      await commit();
      return true;
    });
  };
  turnQueues.set(session, {
    read: () => ({
      items: [...items.values()].map(({ id, input }) => ({
        id,
        content: input.content,
        attachments: input.files?.length ?? 0,
      })),
      paused: items.size > 0 && (held || (!busy && !completed)),
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
          held = false;
          completed = true;
          return;
        }
        const item = items.get(command.id);
        if (!item) throw new Error("That message has already left the queue.");
        if (command.action === "edit") {
          item.input = { ...item.input, content: command.content };
          item.head = await scopes.read(session.thread.requireId());
        } else items.delete(command.id);
        await commit();
      });
      if (command.action === "resume") await session.drainFollowUpQueue();
    },
  });
  return {
    ready,
    close: () => {
      off();
      turnQueues.delete(session);
    },
  };
}
