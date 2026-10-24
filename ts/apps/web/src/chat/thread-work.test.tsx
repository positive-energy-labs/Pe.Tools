// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { threadWorkSnapshotSchema } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { CHAT_SEED_THREAD_WORK } from "./seeds";
import { demoThreads } from "./thread-navigation";
import { ThreadsSidebar } from "./thread-palette";
import * as work from "./thread-work";

vi.mock("./thread-work", async (original) => {
  const actual = await original<typeof import("./thread-work")>();
  return { ...actual, useThreadWorks: vi.fn(actual.useThreadWorks) };
});
vi.mock("#/host/pe-client", () => ({ peClient: {} }));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));

beforeEach(() => {
  window.history.replaceState({}, "", "/pea?demo=send");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(2000);
  HTMLElement.prototype.scrollTo ??= () => {};
  vi.stubGlobal("localStorage", { getItem: () => "open", setItem: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const roster = () => demoThreads({ ...emptyChatState(), id: "demo-review", title: "Review" });
function mount(threads = roster()) {
  const onSelect = vi.fn(),
    onWork = vi.fn();
  render(
    <ThreadsSidebar
      threads={threads as never}
      currentThreadId="demo-review"
      providers={[]}
      onSelect={onSelect}
      onWork={onWork}
      onFork={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn(async () => true)}
      onNewTarget={vi.fn()}
    />,
  );
  return { onSelect, onWork };
}
const row = (text: string) => screen.getByText(text).closest<HTMLElement>('[role="option"]')!;

test("the demo fixture is the published snapshot contract", () => {
  expect(threadWorkSnapshotSchema.parse(CHAT_SEED_THREAD_WORK)).toEqual(CHAT_SEED_THREAD_WORK);
});

test("rows lead with remembered documents and unfinished Work, never session or target labels", () => {
  mount();
  // One document with two Works: its name, the lead Work's chip and intent, the rest counted.
  expect(row("Operations Demo.rvt").textContent).toContain("2 unfinished");
  expect(row("Operations Demo.rvt").textContent).toContain("duct resize +1");
  // Three documents, one closed: the first name and the rest as a count.
  expect(row("Level 2.rvt +2")).toBeTruthy();
  // A closed document with unfinished Work still shows it.
  expect(row("Level 1.rvt").textContent).toContain("4 unfinished");
  // No document: the conversation title stands in.
  expect(row("Draft the BIM handoff notes")).toBeTruthy();
  const text = screen.getByRole("navigation", { name: "Threads" }).textContent ?? "";
  for (const label of [
    "pe.app-2",
    "Closed session",
    "Closed document",
    "Document in",
    "Untargeted",
  ])
    expect(text).not.toContain(label);
});

test("a thread press opens the conversation; a Work press opens the tool", async () => {
  const { onSelect, onWork } = mount();
  fireEvent.click(row("Operations Demo.rvt"));
  expect(onSelect).toHaveBeenCalledWith("demo-review");
  expect(onWork).not.toHaveBeenCalled();
  onSelect.mockClear();
  fireEvent.click(
    row("Operations Demo.rvt").querySelector<HTMLElement>('button[aria-label="Open duct resize"]')!,
  );
  expect(onSelect).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(onWork).toHaveBeenCalledWith("demo-review", "ducts", undefined));
});

test("a Work press on a closed document goes through the resume lookup and opens its route", async () => {
  const { onWork } = mount();
  fireEvent.click(
    row("Level 1.rvt").querySelector<HTMLElement>('button[aria-label="Open duct resize"]')!,
  );
  await vi.waitFor(() => expect(onWork).toHaveBeenCalledWith("fixture-ended", "ducts", undefined));
});

test("partial discovery says so once at the list's end", () => {
  mount();
  expect(document.querySelectorAll("[data-thread-work-partial]")).toHaveLength(1);
  expect(screen.getByText("Work partly read")).toBeTruthy();
});

test("the sidebar reads one batch however many rows it draws", () => {
  const reads = vi.mocked(work.useThreadWorks);
  reads.mockClear();
  mount(roster().slice(0, 2));
  const few = reads.mock.calls.length;
  expect(few).toBeGreaterThan(0);
  cleanup();
  reads.mockClear();
  mount(roster());
  expect(roster().length).toBeGreaterThan(4);
  expect(reads.mock.calls.length).toBe(few);
});
