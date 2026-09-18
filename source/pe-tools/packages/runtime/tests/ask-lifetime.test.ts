import type { Session } from "@mastra/core/agent-controller";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createDeterministicRuntime } from "../src/testing.ts";
import { expireAsks, expireAsksOnNewTurn, readThreadState } from "../src/thread-state.ts";

// Expiry by turn end, new turn, cancel and host restart; survival across reload. Only the model is fake.
const askUser = {
  toolCall: {
    name: "ask_user" as const,
    input: { question: "Which?", options: [{ label: "A" }, { label: "B" }] },
  },
};
const gated = { toolCall: { name: "scenario_approval" as const, input: { value: "v" } } };
const call = "scenario-call-0";

function next(session: Session, type: string) {
  return new Promise<{ toolCallId?: string; reason?: string }>((resolve) => {
    const off = session.subscribe((event) => {
      if (event.type !== type) return;
      off();
      resolve(event as { toolCallId?: string; reason?: string });
    });
  });
}

async function start(responses: Parameters<typeof createDeterministicRuntime>[0]["responses"]) {
  const databasePath = join(await mkdtemp(join(tmpdir(), "ask-lifetime-")), "pea.sqlite");
  const open = async () => {
    const runtime = await createDeterministicRuntime({ databasePath, resourceId: "r", responses });
    const session = await runtime.controller.createSession({
      resourceId: "r",
      scope: "t",
      threadId: "t",
    });
    return { runtime, session };
  };
  return { open, ...(await open()) };
}

/** Sends one turn and parks it: on the permission gate, or past it on the ask_user suspension. */
async function park(session: Session, on: "gate" | "suspension") {
  const gate = next(session, "tool_approval_required");
  const end = next(session, "agent_end");
  await session.sendMessage({ content: "go" });
  await gate;
  if (on === "gate") return { end };
  const suspended = next(session, "tool_suspended");
  session.respondToToolApproval({ decision: "approve", toolCallId: call });
  await suspended;
  expect((await end).reason).toBe("suspended");
  return { end };
}

const pending = (session: Session) => {
  const display = session.displayState.get();
  return [display.pendingApproval?.toolCallId, ...display.pendingSuspensions.keys()].filter(
    Boolean,
  );
};

test("turn end expires a parked ask and drops its resume data", async () => {
  const { runtime, session } = await start([askUser, { text: "done" }]);
  try {
    await park(session, "suspension");
    session.onBeforeAgentEnd((event) => {
      expireAsks(session, event.reason);
    });
    await session.finishAgentRun("complete");

    expect(pending(session)).toEqual([]);
    expect(session.suspensions.has({ toolCallId: call })).toBe(false);
    expect((await readThreadState(runtime, session, "t")).expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "ask_user" }),
    ]);
  } finally {
    await runtime.close?.();
  }
});

test("a new turn expires a parked ask without resuming it", async () => {
  const { runtime, session } = await start([askUser, { text: "fresh turn" }]);
  try {
    expireAsksOnNewTurn(session);
    await park(session, "suspension");
    const resumed: string[] = [];
    session.subscribe((event) => {
      if (event.type === "tool_end") resumed.push(event.toolCallId);
    });
    const ends: string[] = [];
    const fresh = new Promise<void>((resolve) =>
      session.subscribe((event) => {
        if (event.type !== "agent_end") return;
        ends.push(event.reason ?? "");
        if (event.reason === "complete") resolve();
      }),
    );
    await session.sendMessage({ content: "never mind" });
    await fresh;

    // The parked run is cancelled, then the new turn runs whole.
    expect(ends).toEqual(["aborted", "complete"]);
    expect(pending(session)).toEqual([]);
    expect(session.suspensions.has({ toolCallId: call })).toBe(false);
    expect(resumed).toEqual([]);
    const state = await readThreadState(runtime, session, "t");
    expect(JSON.stringify(state.messages)).toContain("fresh turn");
    expect(state.expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "ask_user" }),
    ]);
  } finally {
    await runtime.close?.();
  }
});

test("cancel expires a parked suspension without answering it", async () => {
  const { runtime, session } = await start([askUser, { text: "answered" }]);
  try {
    await park(session, "suspension");
    const cancelled = next(session, "tool_suspension_cancelled");
    session.abort();
    await cancelled;

    expect(pending(session)).toEqual([]);
    const state = await readThreadState(runtime, session, "t");
    expect(JSON.stringify(state.messages)).not.toContain("answered");
    expect(state.expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "ask_user" }),
    ]);
  } finally {
    await runtime.close?.();
  }
});

test("cancel on an armed gate expires it; it is not a denial", async () => {
  const { runtime, session } = await start([gated, { text: "done" }]);
  try {
    const { end } = await park(session, "gate");
    session.abort();
    expect((await end).reason).toBe("aborted");

    expect(pending(session)).toEqual([]);
    expect((await readThreadState(runtime, session, "t")).expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "scenario_approval" }),
    ]);
  } finally {
    await runtime.close?.();
  }
});

test("a human denial is an answer, not an expiry", async () => {
  const { runtime, session } = await start([gated, { text: "done" }]);
  try {
    const { end } = await park(session, "gate");
    session.respondToToolApproval({ decision: "decline", toolCallId: call });
    await end;
    expect((await readThreadState(runtime, session, "t")).expiredAsks).toBeUndefined();
  } finally {
    await runtime.close?.();
  }
});

test("host restart expires the ask; reopening the live session keeps it", async () => {
  const first = await start([askUser, { text: "done" }]);
  await park(first.session, "suspension");

  // Reload: the stream reattaches to the same cached session, whose snapshot still holds the ask.
  const reopened = await first.runtime.controller.createSession({
    resourceId: "r",
    scope: "t",
    threadId: "t",
  });
  expect(reopened).toBe(first.session);
  expect(pending(reopened)).toEqual([call]);
  expect((await readThreadState(first.runtime, reopened, "t")).expiredAsks).toBeUndefined();

  await first.runtime.close?.();
  const restarted = await first.open();
  try {
    expect(pending(restarted.session)).toEqual([]);
    expect((await readThreadState(restarted.runtime, restarted.session, "t")).expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "ask_user" }),
    ]);
  } finally {
    await restarted.runtime.close?.();
  }
});
