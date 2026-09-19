import { expect, test, vi } from "vite-plus/test";
import { chatManifest } from "./manifest";

const ctx = {} as never;

test("new and fork are route verbs with refusals", async () => {
  const newThread = vi.fn();
  const forkThread = vi.fn(async () => undefined);
  const session = {} as never;
  const live = chatManifest({
    thread: "t1",
    session,
    displayKnown: true,
    hasMessages: true,
    newThread,
    forkThread,
  });
  expect(live.actions?.new.ready(ctx, undefined as never)).toBe(null);
  expect(live.actions?.fork.ready(ctx, undefined as never)).toBe(null);
  await live.actions?.new.run(ctx, undefined as never);
  await live.actions?.fork.run(ctx, undefined as never);
  expect(newThread).toHaveBeenCalledOnce();
  expect(forkThread).toHaveBeenCalledOnce();

  const noThread = chatManifest({ thread: "", session, newThread, forkThread });
  expect(noThread.actions?.fork.ready(ctx, undefined as never)).toBe("No thread to fork");
  const empty = chatManifest({ thread: "t1", session, hasMessages: false, newThread, forkThread });
  expect(empty.actions?.fork.ready(ctx, undefined as never)).toBe(
    "This thread has no messages to fork",
  );
  const offline = chatManifest({ thread: "t1", hasMessages: true, newThread, forkThread });
  expect(offline.actions?.fork.ready(ctx, undefined as never)).toBe("Session is not ready");
  const staticRoute = chatManifest({ thread: "" });
  expect(staticRoute.actions?.new.ready(ctx, undefined as never)).toBe("Chat is not ready");
});

test("send remains refused until the current thread establishes its display gate", () => {
  const session = {} as never;
  const pending = chatManifest({ thread: "t1", session, displayKnown: false });
  expect(pending.actions?.send.ready(ctx, { text: "hello" } as never)).toBe(
    "Thread state is loading",
  );
  const ready = chatManifest({ thread: "t1", session, displayKnown: true });
  expect(ready.actions?.send.ready(ctx, { text: "hello" } as never)).toBe(null);
});

test("a parked ask does not hold send; a tool approval does, with its reason", () => {
  const session = {} as never;
  const send = (display: object) =>
    chatManifest({ thread: "t1", session, displayKnown: true, display }).actions?.send.ready(ctx, {
      text: "a new turn",
    } as never);
  const ask = { toolCallId: "ask-1", toolName: "ask_user", suspendPayload: {} };
  // The new turn is how the runtime expires the parked ask.
  expect(send({ isRunning: true, pendingSuspensions: { "ask-1": ask } })).toBe(null);
  expect(send({ isRunning: false, pendingSuspensions: { "ask-1": ask } })).toBe(null);
  expect(send({ pendingApproval: { toolCallId: "t-1", toolName: "run_script" } })).toBe(
    "A tool approval is waiting",
  );
  expect(
    send({
      pendingApproval: { toolCallId: "t-1", toolName: "run_script" },
      pendingSuspensions: { "ask-1": ask },
    }),
  ).toBe("A tool approval is waiting");
  expect(send({ isRunning: true })).toBe("Pea is working");
});
