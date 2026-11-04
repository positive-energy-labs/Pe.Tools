// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ComposerPending } from "./composer-pending";
import { composerAnswer, QuestionForm } from "./question-form";
import type { Approval, Question, ToolCall } from "@pe/agent-contracts/chat-state";

afterEach(cleanup);

const call: ToolCall = {
  id: "call-original",
  title: "script_execute",
  target: "session-original / open-original",
  args: {},
  images: [],
  status: "in_progress",
};
const question: Question = {
  requestId: "question-original",
  message: "Which sheet name?",
  requestedSchema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", title: "Sheet name" } },
  },
};

test("required question fields refuse an empty answer and Enter cannot submit the composer", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const answerQuestion = vi.fn(async () => {});
  const screen = render(
    <form onSubmit={submit}>
      <ComposerPending
        approvals={[]}
        questions={[question]}
        calls={[]}
        resolveApproval={vi.fn()}
        answerQuestion={answerQuestion}
      />
    </form>,
  );
  fireEvent.click(screen.getByRole("button", { name: "1 request needs you" }));
  expect(screen.getByRole("button", { name: "Answer" }).getAttribute("aria-disabled")).toBe("true");
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  fireEvent(screen.getByRole("textbox"), event);
  expect(event.defaultPrevented).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "M-205" } });
  await act(async () => fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" }));
  expect(answerQuestion).toHaveBeenCalledWith("question-original", "accept", { name: "M-205" });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Skip" })));
  expect(answerQuestion).toHaveBeenLastCalledWith("question-original", "decline", undefined);
  expect(answerQuestion).toHaveBeenCalledTimes(2);
});

test("question choices use radio navigation and Enter submits the focused choice once", async () => {
  let finish!: () => void;
  const answer = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const screen = render(
    <form onSubmit={submit}>
      <QuestionForm
        question={{
          ...question,
          requestedSchema: {
            type: "object",
            required: ["choice"],
            properties: {
              choice: {
                title: "Choose",
                oneOf: [
                  { const: "keep", title: "Keep" },
                  { const: "delete", title: "Delete" },
                ],
              },
            },
          },
        }}
        onAnswer={answer}
      />
    </form>,
  );
  const keep = screen.getByRole("radio", { name: "Keep" });
  const remove = screen.getByRole("radio", { name: "Delete" });
  keep.focus();
  fireEvent.keyDown(keep, { key: "ArrowDown" });
  expect(document.activeElement).toBe(remove);
  expect(remove.getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(remove, { key: "Home" });
  expect(document.activeElement).toBe(keep);
  fireEvent.keyDown(keep, { key: "End" });
  fireEvent.keyDown(remove, { key: "Enter" });
  fireEvent.keyDown(remove, { key: "Enter" });
  expect(answer).toHaveBeenCalledExactlyOnceWith("accept", { choice: "delete" });
  expect(submit).not.toHaveBeenCalled();
  await act(async () => finish());
});

test("root-turn write consent stays visible, counts down and sends the host option ids", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-26T12:00:00Z"));
  try {
    const resolveApproval = vi.fn(async () => {});
    const hold: Approval = {
      requestId: "run-approval",
      toolCallId: "run-write",
      toolName: "write",
      scope: "run",
      deadline: "2026-10-26T12:01:00Z",
      options: [
        { optionId: "allow_now", name: "Allow now", kind: "allow_once" },
        { optionId: "stop_writes", name: "Reject", kind: "reject_once" },
      ],
    };
    const screen = render(
      <ComposerPending
        approvals={[hold]}
        questions={[]}
        calls={[
          {
            ...call,
            id: hold.toolCallId,
            caption: "First write: file C:/user/design.json. Then all writes for this turn.",
          },
        ]}
        resolveApproval={resolveApproval}
        answerQuestion={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /request needs you/ })).toBeNull();
    expect(screen.getByRole("timer").textContent).toBe("Reject? 60s");
    expect(
      screen.getByText("First write: file C:/user/design.json. Then all writes for this turn."),
    ).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(18_000);
    });
    expect(screen.getByRole("timer").textContent).toBe("Reject? 42s");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow now" }));
    });
    expect(resolveApproval).toHaveBeenLastCalledWith("run-approval", "allow_now");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });
    expect(resolveApproval).toHaveBeenLastCalledWith("run-approval", "stop_writes");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("timer").textContent).toBe("Reject? 0s");
    expect(resolveApproval).toHaveBeenCalledTimes(2); // The host alone owns deadline approval.
  } finally {
    vi.useRealTimers();
  }
});

// The Claude adapter's AskUserQuestion shape: a pick plus its own "Other" box (claude-agent-acp elicitation.js).
const asked: Question = {
  requestId: "ask-1",
  message: "Which single input should I stage?",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "string",
        title: "Input",
        oneOf: [
          { const: "Terminal cfm", title: "Terminal cfm" },
          { const: "Stop at preview", title: "Stop at preview" },
        ],
      },
      question_0_custom: { type: "string", title: "Other", description: "Type your own answer" },
    },
  },
};

test("a choice or Other never answers by itself; Other focuses its box and Enter there sends the text", async () => {
  const answer = vi.fn(async () => {});
  const screen = render(<QuestionForm question={asked} onAnswer={answer} />);
  fireEvent.click(screen.getByRole("radio", { name: "Terminal cfm" }));
  expect(answer).not.toHaveBeenCalled();
  const other = screen.getByRole("radio", { name: "Other" });
  fireEvent.click(other);
  const box = screen.getByRole("textbox");
  expect(document.activeElement).toBe(box);
  other.focus();
  fireEvent.keyDown(other, { key: "Enter" });
  expect(answer).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(box);
  fireEvent.change(box, { target: { value: "8781191 = 150 cfm" } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  expect(answer).toHaveBeenCalledExactlyOnceWith("accept", {
    question_0: undefined,
    question_0_custom: "8781191 = 150 cfm",
  });
});

test("composer text answers the pending question through its Other box, keeping a pick made above", () => {
  const screen = render(<QuestionForm question={asked} onAnswer={vi.fn()} />);
  expect(composerAnswer(asked, "150 cfm")).toEqual({ question_0_custom: "150 cfm" });
  fireEvent.click(screen.getByRole("radio", { name: "Stop at preview" }));
  expect(composerAnswer(asked, "per schedule")).toEqual({
    question_0: "Stop at preview",
    question_0_custom: "per schedule",
  });
  // A pick-only question has no box for text: the composer refuses rather than dropping it.
  const pickOnly: Question = {
    requestId: "ask-2",
    message: "Pick one",
    requestedSchema: {
      type: "object",
      properties: { choice: { type: "string", oneOf: [{ const: "a", title: "A" }] } },
    },
  };
  expect(composerAnswer(pickOnly, "x")).toBeNull();
});
