import type { Session } from "@mastra/core/agent-controller";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createDeterministicRuntime } from "../src/testing.ts";
import { createPeaSessionAdmission, type PeaRuntimeState } from "../src/pea-runtime.ts";
import { expireAsks, readThreadState } from "../src/thread-state.ts";

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

test("a selection mode with no options is a free-text ask, never a refusal (F-H6-1)", async () => {
  const freeText = {
    toolCall: {
      name: "ask_user" as const,
      input: { question: "Which view?", options: null, selectionMode: "single_select" as const },
    },
  };
  const { runtime, session } = await start([freeText, { text: "done" }]);
  try {
    const gate = next(session, "tool_approval_required");
    const suspended = next(session, "tool_suspended").then(() => "suspended");
    const ended = next(session, "agent_end").then((event) => `ended ${event.reason}`);
    await session.sendMessage({ content: "go" });
    await gate;
    session.respondToToolApproval({ decision: "approve", toolCallId: call });
    expect(await Promise.race([suspended, ended])).toBe("suspended");
    expect(pending(session)).toEqual([call]);
    const stored = JSON.stringify((await readThreadState(runtime, session, "t")).messages);
    expect(stored).not.toContain("selectionMode requires options");
  } finally {
    await runtime.close?.();
  }
});

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

/** Pea's own admission over the harness session, installed after parking so the harness rules parked it. */
async function admit(
  runtime: Awaited<ReturnType<typeof createDeterministicRuntime>>,
  session: Session,
) {
  const admission = createPeaSessionAdmission(
    session as Session<PeaRuntimeState>,
    "trusted",
    undefined,
    runtime.scopes,
  );
  await admission.ready;
  return admission;
}

/** Teardown slower than any fixed cap, as Pea's own document cleanup on `aborted` can be. */
function slowTeardown(session: Session) {
  session.onBeforeAgentEnd(async (event) => {
    if (event.reason === "aborted") await new Promise((resolve) => setTimeout(resolve, 1500));
  });
}

function reasons(session: Session) {
  const ends: string[] = [];
  const completes: Array<() => void> = [];
  session.subscribe((event) => {
    if (event.type !== "agent_end") return;
    ends.push(event.reason ?? "");
    if (event.reason === "complete") completes.shift()?.();
  });
  return { ends, complete: () => new Promise<void>((resolve) => completes.push(resolve)) };
}

test("a new turn expires a parked ask without resuming it, however slow the teardown", async () => {
  const { runtime, session } = await start([askUser, { text: "fresh turn" }]);
  try {
    await park(session, "suspension");
    const admission = await admit(runtime, session);
    slowTeardown(session);
    const resumed: string[] = [];
    session.subscribe((event) => {
      if (event.type === "tool_end") resumed.push(event.toolCallId);
    });
    const { ends, complete } = reasons(session);
    const fresh = complete();
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
    await admission.close();
  } finally {
    await runtime.close?.();
  }
}, 15_000);

test("two rapid new turns over a parked ask both wait out the one teardown", async () => {
  const { runtime, session } = await start([askUser, { text: "first" }, { text: "second" }]);
  try {
    await park(session, "suspension");
    const admission = await admit(runtime, session);
    slowTeardown(session);
    const { ends, complete } = reasons(session);
    const done = complete();
    await Promise.all([
      session.sendMessage({ content: "one" }),
      session.sendMessage({ content: "two" }),
    ]);
    await done;

    expect(ends[0]).toBe("aborted");
    expect(ends).not.toContain("error");
    expect(ends.filter((reason) => reason === "aborted")).toHaveLength(1);
    expect(session.suspensions.has({ toolCallId: call })).toBe(false);
    await admission.close();
  } finally {
    await runtime.close?.();
  }
}, 15_000);

test("a refused turn never expires a parked ask", async () => {
  const { runtime, session } = await start([askUser, { text: "never" }]);
  try {
    await park(session, "suspension");
    const admission = await admit(runtime, session);
    await session.state.set({ yolo: true }); // admission refuses a session whose permissions drifted
    await expect(session.sendMessage({ content: "refused" })).rejects.toThrow();

    expect(pending(session)).toEqual([call]);
    expect(session.suspensions.has({ toolCallId: call })).toBe(true);
    expect((await readThreadState(runtime, session, "t")).expiredAsks).toBeUndefined();
    await admission.close();
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

test("an ask stays an ask after the approval policy changes", async () => {
  const first = await start([gated, { text: "done" }]);
  const { end } = await park(first.session, "gate");
  first.session.abort();
  await end;
  await first.runtime.close?.();

  const restarted = await first.open();
  try {
    await restarted.session.permissions.setForTool({
      toolName: "scenario_approval",
      policy: "allow",
    });
    expect(restarted.session.resolveToolApproval("scenario_approval")).toBe("allow");
    expect((await readThreadState(restarted.runtime, restarted.session, "t")).expiredAsks).toEqual([
      expect.objectContaining({ toolCallId: call, toolName: "scenario_approval" }),
    ]);
  } finally {
    await restarted.runtime.close?.();
  }
});
