// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import { emptyChatState } from "#/workbench/chat-state";

const NO_REFUSAL = Atom.make(null);
const ADDRESS = String.raw`C:\Models\M.rvt`;

const workbench = vi.hoisted(() => ({ value: undefined as any }));
const targetPick = vi.hoisted(() => vi.fn());

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => workbench.value }));
const world = vi.hoisted(() => ({ inventory: [] as unknown, set: (() => {}) as unknown }));
vi.mock("#/readings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/readings")>()),
  targetInventory: () => world.inventory,
}));
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({
    defaultTarget: null,
    revision: 0,
    stale: false,
    hydrated: true,
    set: world.set,
    refusal: null,
  }),
}));
vi.mock("#/route/ladder", () => ({
  Ladder: ({ levels, title }: any) => (
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
    store: { actions: { setPlugin: vi.fn(), planIn: vi.fn() }, atoms: { planRefusal: NO_REFUSAL } },
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
  expect(view.container.querySelector("[data-slot='rail-lead']")?.className).toContain(
    "overflow-x-auto",
  );
  expect(view.container.querySelectorAll("[data-slot='rail']")).toHaveLength(1);
  expect(view.container.querySelector("[data-slot='rail']")?.className).toContain("h-(--rail-h)");
  expect(screen.getByTestId("composer-status").textContent).toBe("failed");
  expect(screen.getByRole("alert").textContent).toBe("the host connection ended");
  expect(
    screen.getByLabelText("Pea proposals").querySelector("[data-tool-id='call-1']"),
  ).not.toBeNull();
  expect(screen.getByTestId("page-log").textContent).toBe("sent");
});

test("the head lists live asks only; an expired ask is a transcript record, not a proposal", () => {
  const chat = emptyChatState();
  chat.expiredAsks = [{ messageId: "a1", toolCallId: "ask-old", toolName: "ask_user" }];
  workbench.value = {
    currentThreadId: "t",
    threads: [],
    chat,
    openThread: vi.fn(),
    resolveApproval: vi.fn(),
    store: { actions: { setPlugin: vi.fn(), planIn: vi.fn() }, atoms: { planRefusal: NO_REFUSAL } },
  };
  const view = render(
    <ComposerHead
      handle={{ demo: true, readings: { head: {}, inventory: {} }, log: [] } as never}
    />,
  );
  expect(screen.queryByLabelText("Pea proposals")).toBe(null);
  expect(view.container.querySelector("[data-tool-id='ask-old']")).toBe(null);
});

test("F-J1-9: a live ask answers in the head; the head never sends the person to the stream", () => {
  const chat = emptyChatState();
  chat.display.pendingSuspensions = {
    "ask-1": {
      toolCallId: "ask-1",
      toolName: "ask_user",
      suspendPayload: { question: "Which model?", options: [{ label: "Use LBPH15A" }] },
    },
  } as never;
  const resolveApproval = vi.fn(async () => {});
  workbench.value = {
    currentThreadId: "t",
    threads: [],
    chat,
    openThread: vi.fn(),
    resolveApproval,
    store: { actions: { setPlugin: vi.fn(), planIn: vi.fn() }, atoms: { planRefusal: NO_REFUSAL } },
  };
  render(
    <ComposerHead
      handle={{ demo: true, readings: { head: {}, inventory: {} }, log: [] } as never}
      status={{ text: "waiting", caution: false }}
    />,
  );
  const head = screen.getByLabelText("Pea proposals");
  expect(head.textContent).not.toContain("answer it in the stream");
  expect(head.textContent).toContain("Which model?");
  fireEvent.click(within(head).getByRole("button", { name: "Use LBPH15A" }));
  expect(resolveApproval).toHaveBeenCalledWith("ask-1", "Use LBPH15A");
});

test("e2e 7 · a new thread under a ?target address pin binds that document once", () => {
  const set = vi.fn(async () => true);
  world.set = set;
  world.inventory = {
    kind: "ready",
    sessions: { s: { kind: "ready", values: [{ openId: "o", address: ADDRESS }] } },
  };
  const bench = (thread: string) => ({
    currentThreadId: thread,
    threads: [],
    chat: emptyChatState(),
    openThread: vi.fn(),
    resolveApproval: vi.fn(),
    store: { actions: { setPlugin: vi.fn(), planIn: vi.fn() }, atoms: { planRefusal: NO_REFUSAL } },
  });
  const handle = { demo: false, readings: { head: {}, inventory: {} }, log: [] } as never;
  workbench.value = bench("t1");
  const view = render(<ComposerHead handle={handle} urlTarget={ADDRESS} />);
  expect(set).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledWith({ kind: "open", ref: { session: "s", openId: "o" } });
  // "new": another thread, the same URL pin; it binds the new thread too, once.
  workbench.value = bench("t2");
  view.rerender(<ComposerHead handle={handle} urlTarget={ADDRESS} />);
  view.rerender(<ComposerHead handle={handle} urlTarget={ADDRESS} />);
  expect(set).toHaveBeenCalledTimes(2);
  world.inventory = [];
});
