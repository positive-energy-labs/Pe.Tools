// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { emptyChatState, type ChatState } from "@pe/agent-contracts/chat-state";
import { harnessEventSchema, workFingerprintSchema } from "@pe/agent-contracts";
import { composerTurn } from "../../../../tests/e2e/composer-turn";
import { ThreadComposer } from "./composer";
import { module, type ChatHandle } from "./route";
import { mountTypedRoute } from "../shell/typed-mount";

let chat: ChatState;
let refusal: string | undefined;
vi.mock("#/workbench/provider", () => ({
  useTranscript: (select: (state: ChatState) => unknown) => select(chat),
  useWorkbench: () => ({
    providers: { list: [{ id: "provider", readiness: { state: "ready" } }] },
    config: { origin: "http://localhost" },
    currentThreadId: "thread",
    threads: [],
    draft: { providerId: "provider" },
    operationError: refusal,
    cancel: vi.fn(),
    forkThread: vi.fn(),
    sendPrompt: vi.fn(),
    answerQuestion: vi.fn(),
  }),
}));
vi.mock("./owner-ports", () => ({ chatReading: () => ({ state: "absent" }) }));
afterEach(cleanup);

test("D26 the real composer goes from working to settled, or failed at its refusal line", async () => {
  const prompt = harnessEventSchema.parse({
    kind: "prompt",
    seq: 1,
    turnId: "turn",
    at: "2026-11-13T00:00:00Z",
    text: "Inspect Work",
  });
  chat = { ...emptyChatState(), providerId: "provider", events: [prompt] };
  refusal = undefined;
  // The composer control needs no model read; keep its real route fields and drawing context.
  const mount = mountTypedRoute(
    {
      ...module,
      spec: {
        ...module.spec,
        core: undefined,
        panes: { ...module.spec.panes, chat: { ...module.spec.panes.chat, read: undefined } },
      },
    },
    {
      address: { read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} },
      target: null,
      fixture: "send",
      work: { address: null, open: null },
      memory: () => ({}),
      custody: { current: () => true },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  );
  const body = () => {
    let content: ReactNode = null;
    mount.draw<ChatHandle>("chat", (handle) => {
      content = <ThreadComposer handle={handle} pickers={null} />;
    });
    return content;
  };
  const observed = (): ReturnType<typeof composerTurn> =>
    window.eval(`(${composerTurn.toString()})()`);
  const screen = render(body());
  const retained = document.createElement("div");
  try {
    expect(screen.getByRole("button", { name: "stop" })).toBeTruthy();
    expect(observed().state).toBe("working");
    retained.style.display = "none";
    retained.append(screen.container.cloneNode(true));
    document.body.prepend(retained);
    chat = {
      ...chat,
      events: [
        ...chat.events,
        harnessEventSchema.parse({
          kind: "turn_end",
          seq: 2,
          turnId: "turn",
          at: "2026-11-13T00:00:01Z",
          stopReason: "end_turn",
        }),
      ],
    };
    screen.rerender(body());
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(observed().state).toBe("settled");
    chat = {
      ...chat,
      events: [
        prompt,
        harnessEventSchema.parse({
          kind: "question_request",
          seq: 2,
          turnId: "turn",
          at: "2026-11-13T00:00:01Z",
          requestId: "ask",
          message: "Which value?",
          requestedSchema: { type: "object", properties: {} },
        }),
      ],
    };
    screen.rerender(body());
    expect(screen.getByRole("button", { name: "Answer Pea's question" })).toBeTruthy();
    expect(observed().state).toBe("settled");
    refusal = "The provider refused the turn";
    screen.rerender(body());
    await waitFor(() => expect(observed()).toEqual({ state: "failed", detail: refusal }));
  } finally {
    retained.remove();
    mount.dispose();
  }
});
