import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { harnessEventSchema, type HarnessEvent } from "@pe/agent-contracts";
import { z } from "zod";

import {
  emptyChatState,
  selectApprovals,
  selectMessages,
  selectQuestions,
  selectQueued,
  selectRunStatus,
  selectTitle,
  selectToolCalls,
  selectTurnFailure,
  type ChatState,
} from "./chat-state";

const at = "2026-10-01T12:00:00.000Z";
const update = (seq: number, turnId: string, body: Record<string, unknown>): HarnessEvent => ({
  seq,
  at,
  kind: "update",
  turnId,
  update: body as { sessionUpdate: string },
});
const chunk = (seq: number, sessionUpdate: string, text: string) =>
  update(seq, "t1", { sessionUpdate, content: { type: "text", text } });
const options = [
  { optionId: "allow", name: "Allow once", kind: "allow_once" as const },
  { optionId: "reject", name: "Reject", kind: "reject_once" as const },
];

/** One turn with thought, speech, one approved tool call, then a second turn left asking. The
 * fixture parses through the contract, so it is a log the host could have written. */
const LOG: HarnessEvent[] = z.array(harnessEventSchema).parse([
  { seq: 1, at, kind: "prompt", turnId: "t1", text: "Read the schedule." },
  chunk(2, "agent_thought_chunk", "Need the file "),
  chunk(3, "agent_thought_chunk", "first."),
  chunk(4, "agent_message_chunk", "Reading "),
  chunk(5, "agent_message_chunk", "it now."),
  update(6, "t1", {
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    title: "mcp__pea__pe_read",
    kind: "read",
    status: "pending",
    rawInput: { key: "op:schedules.read" },
  }),
  {
    seq: 7,
    at,
    kind: "permission_request",
    turnId: "t1",
    requestId: "r1",
    toolCall: { toolCallId: "c1" },
    options,
  },
  {
    seq: 8,
    at,
    kind: "permission_resolved",
    turnId: "t1",
    requestId: "r1",
    optionId: "allow",
    by: "user",
  },
  update(9, "t1", {
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "12 rows" } }],
  }),
  chunk(10, "agent_message_chunk", "Done."),
  update(11, "t1", { sessionUpdate: "some_future_update", whatever: true }),
  { seq: 12, at, kind: "turn_end", turnId: "t1", stopReason: "end_turn" },
  { seq: 13, at, kind: "session", state: "detached", acpSessionId: null },
  { seq: 14, at, kind: "prompt", turnId: "t2", text: "Now write it." },
  update(15, "t2", {
    sessionUpdate: "tool_call",
    toolCallId: "c2",
    title: "mcp__pea__pe_do",
    status: "pending",
    rawInput: { key: "op:schedules.apply" },
  }),
  {
    seq: 16,
    at,
    kind: "permission_request",
    turnId: "t2",
    requestId: "r2",
    toolCall: { toolCallId: "c2" },
    options,
  },
]);

const state = (events: HarnessEvent[]): ChatState => ({ ...emptyChatState(), events });

describe("harness event projection", () => {
  it("folds the log into the transcript rows moments.tsx renders", () => {
    const messages = selectMessages(state(LOG));
    const shape = messages.map((message) => ({
      role: message.role,
      running: message.running,
      parts: message.parts.map((part) =>
        part.type === "tool-call"
          ? {
              tool: part.call.title,
              status: part.call.status,
              target: part.call.target,
              result: part.call.result,
              asks: part.approval?.options.map((option) => option.name),
            }
          : { [part.type]: "text" in part ? part.text : "" },
      ),
    }));
    expect(shape).toEqual([
      { role: "user", running: false, parts: [{ text: "Read the schedule." }] },
      {
        role: "assistant",
        running: false,
        parts: [
          { reasoning: "Need the file first." },
          { text: "Reading it now." },
          {
            tool: "pe_read",
            status: "completed",
            target: "op:schedules.read",
            result: "12 rows",
            asks: undefined,
          },
          { text: "Done." },
        ],
      },
      {
        role: "system",
        running: false,
        parts: [{ text: "new harness session; Pea re-fed the transcript from its record" }],
      },
      { role: "user", running: false, parts: [{ text: "Now write it." }] },
      {
        role: "assistant",
        running: true,
        parts: [
          {
            tool: "pe_do",
            status: "in_progress",
            target: "op:schedules.apply",
            result: undefined,
            asks: ["Allow once", "Reject"],
          },
        ],
      },
    ]);
    expect(selectRunStatus(state(LOG))).toBe("waiting");
    expect(selectApprovals(state(LOG)).map((approval) => approval.requestId)).toEqual(["r2"]);
  });

  it("ends the running row on turn_end and on error", () => {
    const ended = [
      ...LOG,
      { seq: 17, at, kind: "turn_end", turnId: "t2", stopReason: "cancelled" },
    ] satisfies HarnessEvent[];
    const [turn, said] = selectMessages(state(ended)).slice(-2);
    expect(turn!.running).toBe(false);
    expect(turn!.parts[0]).toMatchObject({ call: { status: "cancelled" } });
    // The cancel explains itself: one quiet line in that turn.
    expect(said).toMatchObject({ role: "system", parts: [{ text: "cancelled" }] });
    expect(selectRunStatus(state(ended))).toBe("idle");

    const failed = [
      ...LOG.slice(0, 14),
      { seq: 15, at, kind: "error", turnId: "t2", message: "harness exited" },
    ] satisfies HarnessEvent[];
    expect(selectRunStatus(state(failed))).toBe("idle");
    expect(selectMessages(state(failed)).slice(-2)).toMatchObject([
      { role: "user" },
      { role: "system", parts: [{ text: "harness exited" }] },
    ]);
  });

  it("lists a queued prompt until its prompt event starts it", () => {
    const queued = [
      ...LOG.slice(0, 14),
      { seq: 15, at, kind: "queued", turnId: "t3", text: "Then the sheets." },
      { seq: 16, at, kind: "queued", turnId: "t4", text: "And the views." },
    ] satisfies HarnessEvent[];
    expect(selectQueued(state(queued))).toEqual([
      { turnId: "t3", text: "Then the sheets." },
      { turnId: "t4", text: "And the views." },
    ]);
    const started = [
      ...queued,
      { seq: 17, at, kind: "turn_end", turnId: "t2", stopReason: "end_turn" },
      { seq: 18, at, kind: "prompt", turnId: "t3", text: "Then the sheets." },
    ] satisfies HarnessEvent[];
    expect(selectQueued(state(started))).toEqual([{ turnId: "t4", text: "And the views." }]);
  });

  it("settles an ask: a reject denies the call, a host restart expires it", () => {
    const denied = [
      ...LOG,
      {
        seq: 17,
        at,
        kind: "permission_resolved",
        turnId: "t2",
        requestId: "r2",
        by: "user",
        optionId: "reject",
      },
      // The harness reports the refusal as a failed call; it stays denied.
      update(18, "t2", { sessionUpdate: "tool_call_update", toolCallId: "c2", status: "failed" }),
    ] satisfies HarnessEvent[];
    expect(selectToolCalls(state(denied)).at(-1)?.status).toBe("denied");

    const expired = [
      ...LOG,
      { seq: 17, at, kind: "permission_resolved", turnId: "t2", requestId: "r2", by: "expired" },
    ] satisfies HarnessEvent[];
    expect(selectToolCalls(state(expired)).at(-1)?.status).toBe("expired");
    expect(selectApprovals(state(expired))).toEqual([]);
  });

  it("unwraps codex's MCP input and parses a JSON text result", () => {
    const codex = [
      { seq: 1, at, kind: "prompt", turnId: "t1", text: "Find schedules." },
      update(2, "t1", {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "pea.pe_find",
        status: "in_progress",
        rawInput: { server: "pea", tool: "pe_find", arguments: { query: "schedule" } },
      }),
      update(3, "t1", {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        rawOutput: { content: [{ type: "text", text: '{"hits":[{"key":"op:schedules.read"}]}' }] },
      }),
    ] satisfies HarnessEvent[];
    expect(selectToolCalls(state(codex))[0]).toMatchObject({
      title: "pe_find",
      args: { query: "schedule" },
      target: "schedule",
      result: { hits: [{ key: "op:schedules.read" }] },
      status: "completed",
    });
  });

  it("unwraps codex's MCP result wrapper the same way", () => {
    const wrapped = [
      update(1, "t1", {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        rawOutput: { result: { content: [{ type: "text", text: '{"hits":[]}' }] } },
      }),
    ] satisfies HarnessEvent[];
    expect(selectToolCalls(state(wrapped))[0]?.result).toEqual({ hits: [] });
  });

  it("says a resumed session in one quiet line; a started one says nothing", () => {
    const sessions = [
      ...LOG.slice(0, 12),
      { seq: 13, at, kind: "session", state: "started", acpSessionId: "s2" },
      { seq: 14, at, kind: "session", state: "resumed", acpSessionId: "s2" },
    ] satisfies HarnessEvent[];
    const said = selectMessages(state(sessions)).filter((message) => message.role === "system");
    expect(said.map((message) => message.parts)).toEqual([
      [{ type: "text", text: "session resumed" }],
    ]);
  });

  it("a session event after a turn's first prompt keeps that turn running", () => {
    // The order a lazily spawned or resumed child writes (re-drive 2026-10-01, thread 51413e4b).
    for (const sessionState of ["started", "resumed"] as const) {
      const log = [
        { seq: 1, at, kind: "prompt", turnId: "t1", text: "Tell me a story." },
        { seq: 2, at, kind: "session", state: sessionState, acpSessionId: "s1" },
        chunk(3, "agent_message_chunk", "Once"),
      ] satisfies HarnessEvent[];
      expect(selectRunStatus(state(log))).toBe("running");
    }
  });

  it("a host restart is a record under the turn, not a failure; other errors stay failures", () => {
    const restarted = [
      ...LOG.slice(0, 14),
      { seq: 15, at, kind: "error", turnId: "t2", message: "host restarted during this turn" },
    ] satisfies HarnessEvent[];
    expect(selectTurnFailure(state(restarted))).toBeUndefined();
    expect(selectRunStatus(state(restarted))).toBe("idle");
    expect(selectMessages(state(restarted)).at(-1)).toMatchObject({
      role: "system",
      parts: [{ text: "host restarted during this turn" }],
    });

    const failed = [
      ...LOG.slice(0, 14),
      { seq: 15, at, kind: "error", turnId: "t2", message: "harness exited" },
    ] satisfies HarnessEvent[];
    expect(selectTurnFailure(state(failed))).toBe("harness exited");
  });

  it("parks a form question until answered; a skip or a cancel leaves a quiet line", () => {
    const form = { properties: { pick: { type: "string" } }, required: ["pick"] };
    const asked = [
      ...LOG,
      {
        seq: 17,
        at,
        kind: "question_request",
        turnId: "t2",
        requestId: "q1",
        message: "Which one?",
        requestedSchema: form,
      },
    ] satisfies HarnessEvent[];
    expect(selectQuestions(state(asked))).toEqual([
      { requestId: "q1", message: "Which one?", requestedSchema: form },
    ]);
    expect(selectRunStatus(state(asked))).toBe("waiting");
    const resolved = (tail: object) =>
      state([
        ...asked,
        { seq: 18, at, kind: "question_resolved", turnId: "t2", requestId: "q1", ...tail },
      ] as HarnessEvent[]);
    const answered = resolved({ by: "user", action: "accept", content: { pick: "a" } });
    expect(selectQuestions(answered)).toEqual([]);
    expect(selectMessages(answered).some((row) => row.id === "question_resolved-18")).toBe(false);
    const skipped = resolved({ by: "user", action: "decline" });
    expect(selectMessages(skipped).find((row) => row.id === "question_resolved-18")?.parts).toEqual(
      [{ type: "text", text: "question skipped" }],
    );
    const cancelled = resolved({ by: "cancel" });
    expect(
      selectMessages(cancelled).find((row) => row.id === "question_resolved-18")?.parts,
    ).toEqual([{ type: "text", text: "question cancelled" }]);
  });

  it("titles the thread from the newest title_changed, else the body", () => {
    expect(selectTitle({ ...state(LOG), title: "untitled" })).toBe("untitled");
    const renamed = [
      ...LOG,
      { seq: 17, at, kind: "title_changed", title: "Schedule write" },
    ] satisfies HarnessEvent[];
    expect(selectTitle(state(renamed))).toBe("Schedule write");
  });
});

/** Real host logs from the 2026-10-01 drive, one per harness: a pe_find call and its answer. */
describe.each(["claude", "codex"])("%s fixture log", (harness) => {
  const events = readFileSync(
    join(import.meta.dirname, "fixtures", `${harness}-pe-find.events.jsonl`),
    "utf8",
  )
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => harnessEventSchema.parse(JSON.parse(line)));
  const logged = state(events);

  it("folds a pe_find call with its IN and pretty OUT, then the answer naming the key", () => {
    const find = selectToolCalls(logged).find((call) => call.title === "pe_find");
    expect(find).toMatchObject({ args: { query: "rooms" }, status: "completed" });
    expect(JSON.stringify(find!.args)).toBe('{"query":"rooms"}');
    // OUT is the parsed JSON, not the text block or codex's `{result: {content}}` wrapper.
    expect((find!.result as { matches: { key: string }[] }).matches[0]?.key).toBe(
      "workflow:rooms.merge",
    );
    const lastText = selectMessages(logged)
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "text")
      .at(-1);
    expect(lastText?.type === "text" && lastText.text).toContain("workflow:rooms.merge");
  });
});
