import type { Session } from "@mastra/core/agent-controller";
import { createTool } from "@mastra/core/tools";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { createDeterministicRuntime } from "../src/testing.ts";
import { readThreadState, turnEndKey } from "../src/thread-state.ts";

// A person's cancel is recorded per call, so the transcript can say `cancelled` honestly; a host
// restart and an unanswered ask stay what they were. Only the model is fake.
const call = "scenario-call-0";
// Its own thread: Mastra's thread lock is shared by every test process on this machine.
const thread = `call-cancel-${crypto.randomUUID()}`;
/** A gated call that, once approved, never settles: a native call still in flight at cancel. */
const inFlight = createTool({
  id: "pe_find",
  description: "Never settles.",
  inputSchema: z.object({}),
  requireApproval: true,
  execute: () => new Promise<never>(() => {}),
});

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

async function start() {
  const databasePath = join(await mkdtemp(join(tmpdir(), "call-cancel-")), "pea.sqlite");
  const open = async () => {
    const runtime = await createDeterministicRuntime({
      databasePath,
      resourceId: "r",
      responses: [{ toolCall: { name: "pe_find", input: {} } }],
      tools: { pe_find: inFlight },
    });
    const session = await runtime.controller.createSession({
      resourceId: "r",
      scope: thread,
      threadId: thread,
    });
    return { runtime, session };
  };
  return { open, ...(await open()) };
}

/** Sends a turn and stops at its gate; `approve` lets the call run, stored as a `call` part. */
async function gate(
  runtime: Awaited<ReturnType<typeof start>>["runtime"],
  session: Session,
  approve: boolean,
) {
  const armed = next(session, "tool_approval_required");
  void session.sendMessage({ content: "find" }).catch(() => undefined);
  await armed;
  if (approve) session.respondToToolApproval({ decision: "approve", toolCallId: call });
  await expect
    .poll(async () => JSON.stringify((await readThreadState(runtime, session, thread)).messages))
    .toContain(call);
}

test("a person's cancel lists the approved call it stopped", async () => {
  const { runtime, session } = await start();
  try {
    await gate(runtime, session, true);
    const ended = next(session, "agent_end", "aborted");
    session.abort();
    await ended;

    const state = await readThreadState(runtime, session, thread);
    expect(state.cancelledCalls).toEqual([
      { messageId: expect.any(String), toolCallId: call, toolName: "pe_find" },
    ]);
    // Approved, it was answered: never "expired, unanswered".
    expect(state.expiredAsks).toBeUndefined();
  } finally {
    await runtime.close?.();
  }
});

test("a host restart lists nothing: the call ended without a terminal result", async () => {
  const first = await start();
  await gate(first.runtime, first.session, true);
  await first.runtime.close?.();
  const { runtime, session } = await first.open();
  try {
    const state = await readThreadState(runtime, session, thread);
    expect(JSON.stringify(state.messages)).toContain(call);
    expect(state.cancelledCalls).toBeUndefined();
    expect(state.expiredAsks).toBeUndefined();
  } finally {
    await runtime.close?.();
  }
});

test("an ask a cancel ends stays an expired ask, not a cancelled call", async () => {
  const { runtime, session } = await start();
  try {
    await gate(runtime, session, false);
    const ended = next(session, "agent_end", "aborted");
    session.abort();
    await ended;

    const state = await readThreadState(runtime, session, thread);
    expect(state.expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "pe_find" }),
    ]);
    expect(state.cancelledCalls).toBeUndefined();
  } finally {
    await runtime.close?.();
  }
});

test("a turn that ends in error records its cause and the calls it left running (F-H6-8)", async () => {
  const { runtime, session } = await start();
  try {
    const started = next(session, "tool_start");
    await gate(runtime, session, true);
    await started;
    const runId = session.run.getRunId()!;
    // What the controller does when a stream chunk throws (handleSubscribedStreamError): it
    // ends the session's turn while the call is still in flight.
    session.emit({ type: "error", error: new Error("chunk handler threw") });
    await session.finishAgentRun("error");

    await expect
      .poll(() => session.thread.getSetting({ key: turnEndKey(runId) }))
      .toEqual({ reason: "error", error: "chunk handler threw", running: [call] });
  } finally {
    await runtime.close?.();
  }
});
