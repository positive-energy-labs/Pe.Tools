// @vitest-environment jsdom
import type { MastraDBMessage } from "@mastra/client-js";
import { RegistryContext } from "@effect/atom-react";
import { askExpiryTriggers } from "@pe/agent-contracts";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, selectMessages, selectToolCalls, type ChatState } from "./chat-state";
import { createChatPageStore } from "./store";
import { CurrentThreadViewOwner } from "./thread-view";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));

import { CellHeader } from "./lens/context-strip";
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

// After a host restart: the stored ask call never reached a terminal state and nothing is live.
const expired: ChatState = {
  ...emptyChatState(),
  messages: [askCall],
  expiredAsks: [{ messageId: "a1", toolCallId: "ask-1", toolName: "ask_user" }],
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

test("an expired ask is a transcript record line with no answer buttons and no invented cause", () => {
  const { container } = mount(expired);
  const call = container.querySelector("[data-tool-id='ask-1']")!;
  const marker = call.querySelector("[data-annotation='tool-marker']")!;
  expect(marker.textContent).toBe("⌗ Ask User — expired, unanswered");
  // The only pressable thing is the marker's inspect toggle; nothing answers the ask.
  expect([...call.querySelectorAll("button, [role='button']")]).toEqual([marker]);
  expect(screen.queryByLabelText("Answer")).toBe(null);
  // Neither running nor failed nor a success tag.
  expect(marker.className).toBe("");
  expect(marker.querySelector("[data-tone]")).toBe(null);
  // ExpiredAsk carries no cause, so none of the contract's trigger words is drawn.
  for (const trigger of askExpiryTriggers) expect(marker.textContent).not.toContain(trigger);
});

test("the context strip draws an expired call as a quiet record, not running or failed", () => {
  const [call] = selectToolCalls(expired);
  const { container } = render(<CellHeader call={call!} />);
  const meta = container.querySelector("[data-annotation='cell-meta']")!;
  expect(meta.textContent).toBe("expired");
  expect(meta.textContent).not.toMatch(/in progress|failed/);
});

test("expired is keyed by the runtime's ask record, never by the tool name", () => {
  const stopped = (toolCallId: string, toolName: string) =>
    ({
      ...askCall,
      id: `m-${toolCallId}`,
      content: {
        format: 2,
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { state: "call", toolCallId, toolName, args: {} },
          },
        ],
      },
    }) as unknown as MastraDBMessage;
  const state: ChatState = {
    ...emptyChatState(),
    messages: [askCall, stopped("run-1", "run_script"), stopped("ask-2", "ask_user")],
    expiredAsks: [{ messageId: "a1", toolCallId: "ask-1", toolName: "ask_user" }],
  };
  const status = Object.fromEntries(selectToolCalls(state).map((call) => [call.id, call.status]));
  // No record, no label: a stopped call the runtime did not record reads `failed`.
  expect(status).toEqual({ "ask-1": "expired", "run-1": "failed", "ask-2": "failed" });
});

test("a cancelled call is the runtime's record line: a word, no tag, no button; unrecorded stays failed", () => {
  const call = (toolCallId: string) =>
    ({
      ...askCall,
      id: `m-${toolCallId}`,
      content: {
        format: 2,
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { state: "call", toolCallId, toolName: "run_script", args: {} },
          },
        ],
      },
    }) as unknown as MastraDBMessage;
  const state: ChatState = {
    ...emptyChatState(),
    messages: [call("run-1"), call("run-2")],
    cancelledCalls: [{ messageId: "m-run-1", toolCallId: "run-1", toolName: "run_script" }],
  };
  const [cancelled, restarted] = selectToolCalls(state);
  expect(cancelled!.status).toBe("cancelled");
  // An approved call that ran into a restart is not a cancel and not an expired ask.
  expect(restarted).toMatchObject({
    status: "failed",
    error: "Tool call ended without a terminal result.",
  });
  const { container } = mount(state);
  const marker = container.querySelector("[data-tool-id='run-1'] [data-annotation='tool-marker']")!;
  expect(marker.textContent).toBe("⌗ Run Script — cancelled");
  expect(marker.querySelector("[data-tone]")).toBe(null);
  expect(marker.className).toBe("");
  expect([
    ...container.querySelectorAll(
      "[data-tool-id='run-1'] button, [data-tool-id='run-1'] [role='button']",
    ),
  ]).toEqual([marker]);
});
