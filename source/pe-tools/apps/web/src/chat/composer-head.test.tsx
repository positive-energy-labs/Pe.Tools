// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState } from "#/workbench/chat-state";

const workbench = vi.hoisted(() => ({ value: undefined as any }));
const targetPick = vi.hoisted(() => vi.fn());

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("#/readings", () => ({ targetInventory: () => [] }));
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({
    defaultTarget: null,
    revision: 0,
    stale: false,
    set: vi.fn(),
    refusal: null,
  }),
}));
vi.mock("#/route/picker", () => ({
  Picker: ({ levels, title }: any) => (
    <button
      title={title}
      onClick={() => levels[0].pick(levels[0].key === "thread" ? "thread-b" : "document-a")}
    >
      {levels[0].label}
    </button>
  ),
}));
vi.mock("#/route/situation", () => ({
  ChainLamp: () => <span>lamp</span>,
  Cluster: ({ state }: any) => <div data-testid="cluster">{state}</div>,
  Ledger: () => <span>ledger</span>,
  PageLog: ({ entries }: any) => <span data-testid="page-log">{entries[0]?.label}</span>,
  SituationCell: ({ children }: any) => <span>{children}</span>,
  useDocumentLadder: () => ({
    levels: [
      {
        key: "target",
        label: null,
        placeholder: "optional Revit target",
        options: [],
        pick: targetPick,
      },
    ],
    sessionWord: null,
    docWord: null,
  }),
}));

import { ComposerHead } from "./composer-head";

afterEach(cleanup);

test("the Situation keeps both selectors reachable in its scrolling sentence", () => {
  const openThread = vi.fn();
  const chat = emptyChatState();
  chat.display.pendingSuspensions = {
    question: { toolCallId: "call-1", toolName: "ask_user", suspendPayload: {} },
  } as never;
  workbench.value = {
    currentThreadId: "new-thread",
    threads: [{ id: "thread-b", title: "Second", updatedAt: "10:00" }],
    chat,
    openThread,
    resolveApproval: vi.fn(),
  };
  const view = render(
    <ComposerHead
      handle={
        { demo: true, readings: { head: {}, inventory: {} }, log: [{ label: "sent" }] } as never
      }
      status={{ text: "failed", caution: true, detail: "the host connection ended" }}
    />,
  );

  expect(screen.getByTitle("choose the active chat thread").textContent).toBe("new-thread");
  fireEvent.click(screen.getByTitle("choose the active chat thread"));
  expect(openThread).toHaveBeenCalledWith("thread-b");
  fireEvent.click(
    screen.getByTitle(
      "choose a session and a document; Chat runs without one, Revit operations do not",
    ),
  );
  expect(targetPick).toHaveBeenCalledWith("document-a");
  expect(screen.getByTestId("composer-sentence").className).toContain("overflow-x-auto");
  expect(view.container.querySelectorAll("[data-slot='rail']")).toHaveLength(1);
  expect(view.container.querySelector("[data-slot='rail']")?.className).toContain("h-(--rail-h)");
  expect(screen.getByTestId("composer-status").textContent).toBe("failed");
  expect(screen.getByRole("alert").textContent).toBe("the host connection ended");
  expect(screen.getByLabelText("Pea proposals").textContent).toContain("waiting on you");
  expect(screen.getByTestId("page-log").textContent).toBe("sent");
});
