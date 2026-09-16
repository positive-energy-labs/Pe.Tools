// @vitest-environment jsdom
import type { MastraDBMessage } from "@mastra/client-js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectMessages, type ChatState } from "./chat-state";
import { toFiles } from "./provider/use-workbench";

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => ({}) }));

import { Moments } from "./moments";

afterEach(cleanup);

const PNG = "iVBORw0KGgo=";
const TEXT_FILE = "[File: notes.txt]\n```\nhello\n```";

// The persisted row exactly as `/pe/thread` returned it in the deterministic runtime
// (packages/runtime/tests/attachments.test.ts), trimmed.
const persisted = {
  id: "u1",
  role: "signal",
  type: "user",
  createdAt: "2026-09-16T19:04:34.345Z",
  content: {
    format: 2,
    parts: [
      { type: "text", text: "look" },
      { type: "file", data: PNG, mimeType: "image/png", filename: "dot.png" },
      { type: "file", data: "aGVsbG8=", mimeType: "application/pdf", filename: "spec.pdf" },
      { type: "text", text: TEXT_FILE },
    ],
    metadata: { signal: { id: "u1", type: "user" } },
  },
} as unknown as MastraDBMessage;

// The live `message_start` for the same turn: Mastra's signal part carries the files in
// `contents` (`partsToSignalContents`).
const pending = {
  id: "u1",
  role: "signal",
  createdAt: new Date("2026-09-16T19:04:34.345Z"),
  content: {
    format: 2,
    parts: [
      {
        type: "data-user-message",
        data: {
          id: "u1",
          type: "user",
          contents: [
            { type: "text", text: "look" },
            { type: "file", data: PNG, mediaType: "image/png", filename: "dot.png" },
            { type: "file", data: "aGVsbG8=", mediaType: "application/pdf", filename: "spec.pdf" },
            { type: "text", text: TEXT_FILE },
          ],
        },
      },
    ],
    metadata: { signal: { id: "u1", type: "user" } },
  },
} as unknown as MastraDBMessage;

const EXPECTED = [
  { type: "text", text: "look" },
  { type: "image", image: `data:image/png;base64,${PNG}`, name: "dot.png" },
  { type: "file", name: "spec.pdf", mimeType: "application/pdf" },
  { type: "file", name: "notes.txt", mimeType: "text/plain" },
];

test("a persisted user row lists its attachments", () => {
  const state: ChatState = { ...emptyChatState(), messages: [persisted] };
  expect(selectMessages(state)[0]?.parts).toEqual(EXPECTED);
});

test("the pending user row lists the same attachments before the echo", () => {
  const state: ChatState = {
    ...emptyChatState(),
    display: { isRunning: true, currentMessage: pending } as unknown as ChatState["display"],
  };
  expect(selectMessages(state)[0]?.parts).toEqual(EXPECTED);
});

test("the thread draws an image thumbnail and a chip per other file", () => {
  const state: ChatState = { ...emptyChatState(), messages: [persisted] };
  const { container } = render(<Moments messages={selectMessages(state)} register={() => {}} />);
  expect(container.querySelector(`img[src='data:image/png;base64,${PNG}']`)).toBeTruthy();
  expect(screen.getByText("spec.pdf")).toBeTruthy();
  expect(screen.getByText("notes.txt")).toBeTruthy();
  expect(screen.getByText("look")).toBeTruthy();
  expect(container.textContent).not.toContain("[File:");
});

test("a text attachment reaches Mastra as a data URL it can decode", () => {
  const [file] = toFiles([{ name: "notes.txt", mimeType: "text/plain", text: "hello" }]) ?? [];
  expect(file?.data).toBe("data:text/plain;base64,aGVsbG8=");
});
