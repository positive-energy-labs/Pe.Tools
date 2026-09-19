// @vitest-environment jsdom
import type { MastraDBMessage } from "@mastra/client-js";
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectMessages, selectToolCalls, type ChatState } from "./chat-state";
import { createChatPageStore } from "./store";
import { CurrentThreadViewOwner } from "./thread-view";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));

import { Moments } from "./moments";

afterEach(cleanup);

const askCall = {
  id: "a1",
  role: "assistant",
  createdAt: new Date("2026-09-18T12:00:00Z"),
  content: {
    format: 2,
    parts: [
      {
        type: "tool-invocation",
        toolInvocation: {
          state: "call",
          toolCallId: "ask-1",
          toolName: "ask_user",
          args: { question: "Which?" },
        },
      },
    ],
  },
} as unknown as MastraDBMessage;

/*
 * F-J1-9 (hold 4b): a live ask lives in the Chat head; the transcript holds its record only. Live,
 * Mastra's `agent_end` (reason "suspended") marks every still-running active tool `status:
 * "error"`, the suspended ask among them, so the row read `err` beside its own answer buttons.
 */
const question = { question: "Which?", options: [{ label: "Use A" }, { label: "Use B" }] };
const live: ChatState = {
  ...emptyChatState(),
  messages: [askCall],
  display: {
    ...emptyChatState().display,
    isRunning: false,
    activeTools: { "ask-1": { name: "ask_user", args: {}, status: "error" } },
    pendingSuspensions: {
      "ask-1": { toolCallId: "ask-1", toolName: "ask_user", suspendPayload: question },
    },
  } as never,
};

function mount(state: ChatState) {
  const registry = AtomRegistry.make();
  const store = createChatPageStore({
    registry,
    search: { mode: "threads", patch: async () => undefined },
  });
  workbench.value = { store, resolveApproval: vi.fn() };
  return render(
    <RegistryContext.Provider value={registry}>
      <CurrentThreadViewOwner threadKey="t1" registry={registry} patch={async () => undefined}>
        <Moments messages={selectMessages(state)} register={() => {}} />
      </CurrentThreadViewOwner>
    </RegistryContext.Provider>,
  );
}

test("a live ask the runtime marked error is waiting on the person, not failed", () => {
  expect(selectToolCalls(live)[0]?.status).toBe("in_progress");
});

test("a live ask's transcript row reads wait and draws no answer buttons", () => {
  const { container } = mount(live);
  const call = container.querySelector("[data-tool-id='ask-1']")!;
  const marker = call.querySelector("[data-annotation='tool-marker']")!;
  expect(marker.textContent).toContain("wait");
  expect(marker.textContent).not.toContain("err");
  // The only pressable thing is the marker's inspect toggle; the answer lives in the head.
  expect([...call.querySelectorAll("button, [role='button']")]).toEqual([marker]);
  expect(screen.queryByRole("button", { name: "Use A" })).toBe(null);
});
