// @vitest-environment jsdom
import type { MastraDBMessage } from "@mastra/client-js";
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  emptyChatState,
  selectMessages,
  selectToolCalls,
  toolOutputForDisplay,
  type ChatState,
} from "./chat-state";
import { createChatPageStore } from "./store";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));

import { Moments } from "./moments";

afterEach(cleanup);

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const URL_PNG = `data:image/png;base64,${PNG}`;

// What `capture_view` returns (packages/mcps/src/shared/capture-view.ts).
const captured = {
  text: "Level 1 (…png, 68 bytes, 800px)",
  mediaType: "image/png",
  byteSize: 68,
  data: PNG,
};

function callMessage(result: unknown, state: "result" | "call"): MastraDBMessage {
  return {
    id: "a1",
    role: "assistant",
    createdAt: new Date("2026-09-16T12:00:00Z"),
    content: {
      format: 2,
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c1",
            toolName: "capture_view",
            args: { target: "Level 1" },
            state,
            ...(result === undefined ? {} : { result }),
          },
        },
      ],
    },
  } as unknown as MastraDBMessage;
}

const finished: ChatState = { ...emptyChatState(), messages: [callMessage(captured, "result")] };

// A running call whose image already rode the progress channel: Mastra stores the progress
// payload stringified on `activeTools[id].partialResult`.
const running: ChatState = {
  ...emptyChatState(),
  display: {
    isRunning: true,
    currentMessage: callMessage(undefined, "call"),
    activeTools: {
      c1: {
        name: "capture_view",
        args: { target: "Level 1" },
        status: "running",
        partialResult: JSON.stringify(captured),
      },
    },
  } as unknown as ChatState["display"],
};

test("the one extractor lists a finished call's images", () => {
  expect(selectToolCalls(finished)[0]?.images).toEqual([URL_PNG]);
});

test("a running call's images come from its partial result", () => {
  const [call] = selectToolCalls(running);
  expect(call?.status).toBe("in_progress");
  expect(call?.images).toEqual([URL_PNG]);
});

test("the displayed output names each image instead of spelling its bytes", () => {
  expect(toolOutputForDisplay(captured)).toEqual({
    ...captured,
    data: "<image 1: image/png, 68 B>",
  });
  expect(
    toolOutputForDisplay([URL_PNG, "plain", { mediaType: "text/plain", data: "eA==" }]),
  ).toEqual(["<image 1: image/png, 68 B>", "plain", { mediaType: "text/plain", data: "eA==" }]);
  expect(captured.data).toBe(PNG);
});

function mount(state: ChatState) {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", patch: async () => undefined },
  });
  workbench.value = { store, resolveApproval: vi.fn() };
  return render(
    <RegistryContext.Provider value={registry}>
      <Moments messages={selectMessages(state)} register={() => {}} />
    </RegistryContext.Provider>,
  );
}

test("a call's images sit under its marker without opening it", () => {
  const { container } = mount(finished);
  const call = container.querySelector("[data-tool-id='c1']")!;
  expect(call.querySelector(`img[src='${URL_PNG}']`)).toBeTruthy();
  expect(container.querySelector("[data-annotation='tool-body']")).toBe(null);
});

test("a running call shows the images already on the wire", () => {
  const { container } = mount(running);
  expect(container.querySelector(`[data-tool-id='c1'] img[src='${URL_PNG}']`)).toBeTruthy();
});

test("opening the call shows a placeholder, not the base64", () => {
  const { container } = mount(finished);
  fireEvent.click(screen.getByTitle(/Open this call's input and output/));
  const body = container.querySelector("[data-annotation='tool-body']");
  expect(body?.textContent).toContain("<image 1: image/png, 68 B>");
  expect(body?.textContent).not.toContain(PNG);
});
