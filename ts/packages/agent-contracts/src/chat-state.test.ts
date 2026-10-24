import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { harnessEventSchema, type HarnessEvent } from "@pe/agent-contracts";
import { z } from "zod";

import {
  followThread,
  emptyChatState,
  selectApprovals,
  selectMessages,
  selectQuestions,
  selectRunStatus,
  selectToolCalls,
  type ChatState,
} from "@pe/agent-contracts/chat-state";

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
  it("keys each assistant row by the turn that wrote it", () => {
    const said = selectMessages(state(LOG)).filter((m) => m.role === "assistant");
    expect(said.map((m) => m.turnId)).toEqual(said.map(() => expect.stringMatching(/^t\d$/)));
    expect(said[0]!.turnId).toBe("t1");
  });
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

describe("following the host log", () => {
  const event = (seq: number): HarnessEvent => ({
    seq,
    at: "2026-10-13T00:00:00.000Z",
    kind: "title_changed",
    title: `t${seq}`,
  });
  const key = '{"kind":"thread","thread":"a"}';
  it("applies each event once, in seq order; a gap or a hole says re-read the body", () => {
    expect(followThread(1, { kind: "event", key, value: event(2), id: 9 })).toEqual({
      kind: "apply",
      event: event(2),
    });
    expect(followThread(2, { kind: "event", key, value: event(2), id: 9 })).toEqual({
      kind: "skip",
    });
    expect(followThread(2, { kind: "event", key, value: event(4), id: 11 })).toEqual({
      kind: "reread",
    });
    expect(followThread(2, { kind: "gap", key, dropped: null, id: 11 })).toEqual({
      kind: "reread",
    });
  });
});
