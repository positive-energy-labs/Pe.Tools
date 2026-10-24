// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readingKey, threadWorkSnapshotSchema } from "@pe/agent-contracts";
import { peReadings } from "#/readings";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { CHAT_SEED_THREAD_WORK } from "./seeds";
import { demoThreads } from "./thread-navigation";
import { ThreadsSidebar } from "./thread-palette";
import * as work from "./thread-work";

vi.mock("./thread-work", async (original) => {
  const actual = await original<typeof import("./thread-work")>();
  return {
    ...actual,
    useThreadWorks: vi.fn(actual.useThreadWorks),
    resumeWork: vi.fn(actual.resumeWork),
  };
});
const call = vi.hoisted(() => vi.fn());
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));
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
  call.mockReset();
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

const pressClosed = () =>
  fireEvent.click(
    row("Level 1.rvt").querySelector<HTMLElement>('button[aria-label="Open duct resize"]')!,
  );
const hintOf = async (text: string) => {
  fireEvent.focus(row("Level 1.rvt"));
  return screen.findAllByText(new RegExp(text), undefined, { timeout: 2000 });
};

test("a closed Work opens the durable url work.resume answers, and only for a closed document", async () => {
  call.mockResolvedValueOnce({
    id: "w-4",
    key: {},
    url: "/ducts?target=C%3A%2FL1.rvt",
    reason: null,
  });
  const { onWork } = mount();
  pressClosed();
  await vi.waitFor(() =>
    expect(onWork).toHaveBeenCalledWith("fixture-ended", "ducts", "/ducts?target=C%3A%2FL1.rvt"),
  );
  expect(call).toHaveBeenCalledWith("work.resume", { query: { id: "w-4" } });
  call.mockClear();
  fireEvent.click(
    row("Operations Demo.rvt").querySelector<HTMLElement>('button[aria-label="Open duct resize"]')!,
  );
  expect(call).not.toHaveBeenCalled();
});

test("a null url opens the route for retained state and says the reason in the row hint", async () => {
  call.mockResolvedValueOnce({ id: "w-4", key: {}, url: null, reason: "Saved Work is unreadable" });
  const { onWork } = mount();
  pressClosed();
  await vi.waitFor(() => expect(onWork).toHaveBeenCalledWith("fixture-ended", "ducts", undefined));
  expect(await hintOf("Saved Work is unreadable")).not.toHaveLength(0);
});

test("a 404 for an unknown Work is the reason; the row stays pressable", async () => {
  call.mockRejectedValue(
    Object.assign(Error("Route work.resume failed (404)"), {
      status: 404,
      problem: { error: "Saved Work was not found; nothing was changed" },
    }),
  );
  const { onWork } = mount();
  pressClosed();
  await vi.waitFor(() => expect(onWork).toHaveBeenCalledWith("fixture-ended", "ducts", undefined));
  expect(await hintOf("Saved Work was not found")).not.toHaveLength(0);
  pressClosed();
  await vi.waitFor(() => expect(onWork).toHaveBeenCalledTimes(2));
});

test("outside demo the sidebar subscribes to one thread-work Reading and draws only its payload", async () => {
  window.history.replaceState({}, "", "/pea");
  const accepts: ((frame: never) => void)[] = [];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "thread-work") accepts.push(accept as never);
    return () => {};
  });
  mount();
  const text = () => screen.getByRole("navigation", { name: "Threads" }).textContent ?? "";
  // No snapshot yet: conversation titles, and never the fixture.
  expect(text()).toContain("Draft the BIM handoff notes");
  for (const fixture of ["Operations Demo.rvt", "Level 1.rvt", "unfinished", "Work partly read"])
    expect(text()).not.toContain(fixture);
  const reads = () =>
    subscribe.mock.calls.filter(([request]) => request.kind === "thread-work").length;
  expect(reads()).toBe(1);
  act(() =>
    accepts.forEach((accept) =>
      accept({
        kind: "snapshot",
        key: readingKey({ kind: "thread-work" }),
        value: {
          observedAt: "2026-10-24T12:00:00.000Z",
          threads: [
            {
              threadId: "fixture-local",
              documents: [{ id: "d", name: "Live Plant.rvt", availability: "open" }],
              works: [
                { id: "w", documentId: "d", route: "ducts", intent: "live intent", unfinished: 7 },
              ],
            },
          ],
          observations: [],
          truncated: false,
        },
      } as never),
    ),
  );
  expect(row("Live Plant.rvt").textContent).toContain("7 unfinished");
  expect(row("Live Plant.rvt").textContent).toContain("live intent");
  expect(text()).not.toContain("Operations Demo.rvt");
  expect(reads()).toBe(1);
});
