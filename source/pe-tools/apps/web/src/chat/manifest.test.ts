import { expect, test, vi } from "vite-plus/test";
import { chatManifest } from "./manifest";

const ctx = {} as never;

test("new and fork are route verbs with refusals", async () => {
  const newThread = vi.fn();
  const forkThread = vi.fn(async () => undefined);
  const session = {} as never;
  const live = chatManifest({ thread: "t1", session, hasMessages: true, newThread, forkThread });
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
