// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ComposerPending } from "./composer-pending";
import { composerAnswer, QuestionForm } from "./question-form";
import type { Question } from "@pe/agent-contracts/chat-state";

afterEach(cleanup);

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
      <ComposerPending questions={[question]} answerQuestion={answerQuestion} />
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
