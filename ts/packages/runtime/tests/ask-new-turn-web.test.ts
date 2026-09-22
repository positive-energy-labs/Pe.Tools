import type { Session } from "@mastra/core/agent-controller";
import { RequestContext } from "@mastra/core/request-context";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createDeterministicRuntime } from "../src/testing.ts";
import { readThreadState } from "../src/thread-state.ts";

// E2E-J5 at the lowest layer that is the web's: Pea's real web controller policy, and every
// request resolving its session the way Mastra's agent-controller routes do. Only the model is fake.
const call = "scenario-call-0";
const askUser = {
  toolCall: {
    name: "ask_user" as const,
    input: { question: "red or blue?", options: [{ label: "red" }, { label: "blue" }] },
  },
};

/** What `getSession` in Mastra's agent-controller handlers does for `?sessionScope=<thread>`. */
const routeSession = (
  runtime: Awaited<ReturnType<typeof createDeterministicRuntime>>,
  thread: string,
) =>
  runtime.controller.createSession({
    resourceId: "r",
    id: `r::${thread}`,
    scope: thread,
    requestContext: new RequestContext(),
  } as never) as Promise<Session>;

/** What `openSession` in the host's agent-controller-web does for its own thread reads. */
const hostSession = (
  runtime: Awaited<ReturnType<typeof createDeterministicRuntime>>,
  thread: string,
) => runtime.controller.createSession({ resourceId: "r", scope: thread, threadId: thread });

function next(session: Session, type: string, reason?: string) {
  return new Promise<void>((resolve) => {
    const off = session.subscribe((event) => {
      if (event.type !== type) return;
      if (reason && (event as { reason?: string }).reason !== reason) return;
      off();
      resolve();
    });
  });
}

test("J5: a new turn sent through the web route over a parked ask lands, and the ask reads expired after a reload", async () => {
  const databasePath = join(await mkdtemp(join(tmpdir(), "j5-")), "pea.sqlite");
  const prompts: unknown[] = [];
  const runtime = await createDeterministicRuntime({
    databasePath,
    resourceId: "r",
    peaWeb: true,
    onPrompt: (prompt) => prompts.push(prompt),
    responses: [askUser, { text: "fresh turn" }],
  });
  const thread = crypto.randomUUID();
  try {
    // POST …/messages: the ask. `ask_user` asks for permission first, then suspends.
    const first = await routeSession(runtime, thread);
    const gate = next(first, "tool_approval_required");
    const suspended = next(first, "tool_suspended");
    void first.sendMessage({ content: "ask me", requestContext: new RequestContext() } as never);
    await gate;
    (await routeSession(runtime, thread)).respondToToolApproval({
      decision: "approve",
      toolCallId: call,
    });
    await suspended;
    // The person reads the question before typing something else.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // POST …/messages again, instead of answering: acknowledged at once, like the route.
    const second = await routeSession(runtime, thread);
    const errors: unknown[] = [];
    second.subscribe((event) => {
      if (event.type === "error") errors.push((event as { error?: unknown }).error);
    });
    const done = next(second, "agent_end", "complete");
    void second
      .sendMessage({ content: "never mind", requestContext: new RequestContext() } as never)
      .catch((error: unknown) => errors.push(error));
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5_000))]);

    // Reload: GET /pe/thread/:id and the stream's snapshot resolve the session the host's way.
    const reloaded = await hostSession(runtime, thread);
    const state = await readThreadState(runtime, reloaded, thread);
    expect(errors.map(String)).toEqual([]);
    expect(JSON.stringify(state.messages)).toContain("never mind");
    expect(JSON.stringify(state.messages)).toContain("fresh turn");
    expect([...reloaded.displayState.get().pendingSuspensions.keys()]).toEqual([]);
    expect(state.expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "ask_user" }),
    ]);
    // The stored call no longer parks: a reload offers no answer to it.
    expect(JSON.stringify(state.messages)).not.toContain("suspendedTools");
    // The new turn's model sees its question went unanswered: never rejected, never dropped.
    const context = JSON.stringify(prompts.at(-1));
    expect(context).toContain(call);
    expect(context).toContain("unanswered");
    expect(context).not.toMatch(/reject|declin|denied/i);
  } finally {
    await runtime.close?.();
  }
}, 20_000);
