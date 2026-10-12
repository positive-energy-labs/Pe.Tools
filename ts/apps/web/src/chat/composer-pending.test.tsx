// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ComposerPending } from "./composer-pending";
import { QuestionForm } from "./question-form";
import type { Approval, Question, ToolCall } from "../workbench/chat-state";

afterEach(cleanup);

const approval: Approval = {
  requestId: "permission-original",
  toolCallId: "call-original",
  toolName: "script_execute",
  options: [
    { optionId: "allow-original", name: "Allow once", kind: "allow_once" },
    { optionId: "deny-original", name: "Deny", kind: "reject_once" },
  ],
};
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

test("the queue counts live asks, folds without losing a question answer, and dispatches original IDs", async () => {
  const resolveApproval = vi.fn(async () => {});
  const answerQuestion = vi.fn(async () => {});
  const props = {
    approvals: [approval],
    questions: [question],
    calls: [call],
    resolveApproval,
    answerQuestion,
  };
  const screen = render(<ComposerPending {...props} />);
  const queue = screen.getByRole("button", { name: "2 requests need you" });
  expect(queue.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  fireEvent.click(queue);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "M-205" } });
  fireEvent.click(queue);
  fireEvent.click(queue);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("M-205");
  // Another tool's target cannot replace this pending call's exact target.
  screen.rerender(
    <ComposerPending
      {...props}
      calls={[call, { ...call, id: "next-call", target: "new-session / new-open" }]}
    />,
  );
  expect(screen.getByTestId("approval-target").textContent).toBe(call.target);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Allow once" })));
  expect(resolveApproval).toHaveBeenCalledExactlyOnceWith("permission-original", "allow-original");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Answer" })));
  expect(answerQuestion).toHaveBeenCalledExactlyOnceWith("question-original", "accept", {
    name: "M-205",
  });
  screen.rerender(<ComposerPending {...props} approvals={[]} />);
  expect(screen.getByRole("button", { name: "1 request needs you" })).toBeTruthy();
  screen.rerender(<ComposerPending {...props} approvals={[]} questions={[]} />);
  expect(screen.queryByRole("region", { name: "Pending requests" })).toBeNull();
});

test("a pending approval disables every option until the decision finishes", async () => {
  let finish!: () => void;
  const resolveApproval = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(
    <ComposerPending
      approvals={[approval]}
      questions={[]}
      calls={[call]}
      resolveApproval={resolveApproval}
      answerQuestion={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "1 request needs you" }));
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(screen.getByRole("button", { name: "Allow once" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  expect(resolveApproval).toHaveBeenCalledExactlyOnceWith("permission-original", "deny-original");
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Allow once" }).getAttribute("aria-disabled")).toBeNull();
});

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
