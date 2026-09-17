// @vitest-environment jsdom
import type { MastraDBMessage } from "@mastra/client-js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectMessages } from "./chat-state";

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => ({}) }));

import { Moments } from "./moments";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const assistant = {
  id: "a1",
  role: "assistant",
  createdAt: new Date("2026-09-16T12:00:00Z"),
  content: {
    format: 2,
    parts: [
      { type: "reasoning", reasoning: "thinking it over" },
      { type: "text", text: "## Result\n\n- one" },
      { type: "file", data: "iVBORw0KGgo=", mimeType: "image/png" },
      { type: "text", text: "Done, see `Level 1`." },
    ],
  },
} as unknown as MastraDBMessage;

test("each message copies its text as markdown source, and says so", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const messages = selectMessages({ ...emptyChatState(), messages: [assistant] });
  render(<Moments messages={messages} register={() => {}} />);
  const copy = screen.getByTitle("Copy this message as markdown");
  expect(copy.textContent).toBe("copy");
  fireEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith("## Result\n\n- one\n\nDone, see `Level 1`.");
  expect(copy.textContent).toBe("copied");
  act(() => void vi.advanceTimersByTime(1500));
  expect(copy.textContent).toBe("copy");
});

test("the copy control overlays below the message: pea's at the left, yours at the right", () => {
  const user = {
    id: "u1",
    role: "user",
    createdAt: new Date("2026-09-16T11:59:00Z"),
    content: { format: 2, parts: [{ type: "text", text: "hi" }] },
  } as unknown as MastraDBMessage;
  const messages = selectMessages({ ...emptyChatState(), messages: [user, assistant] });
  const { container } = render(<Moments messages={messages} register={() => {}} />);
  const anchor = (role: string) =>
    container.querySelector(`[data-role='${role}'] [data-copy-anchor]`)!.className.split(" ");
  // Out of flow and below the message's box: no added height, no shift.
  expect(anchor("assistant")).toEqual(
    expect.arrayContaining(["absolute", "top-full", "left-[10px]"]),
  );
  expect(anchor("assistant")).not.toContain("right-0");
  expect(anchor("user")).toEqual(expect.arrayContaining(["absolute", "top-full", "right-0"]));
  expect(anchor("user")).not.toContain("left-[10px]");
});
