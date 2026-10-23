import { emptyListSearch, pickListPill, threadSearchDefault } from "@pe/agent-contracts";
const search = (keywords = "", pills: Record<string, string> = {}) =>
  Object.entries(pills).reduce((s, [field, value]) => pickListPill(s, field, value), {
    ...emptyListSearch(),
    keywords,
  });
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { UpdateThreadRequest } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { demoThreads } from "./thread-navigation";
import { ThreadsSidebar, ThreadPane } from "./thread-palette";

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  HTMLElement.prototype.scrollTo ??= () => {};
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 400,
    right: 300,
    width: 300,
    height: 400,
    toJSON() {},
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const surface = vi.hoisted(() => ({ value: "web" }));
const exportResponse = vi.hoisted(() => vi.fn());
vi.mock("#/host/pe-client", () => ({ peClient: { response: exportResponse } }));
vi.mock("#/navigation/surface-host", () => ({
  useSurfaceHost: () => ({ surface: surface.value }),
}));
afterEach(() => {
  surface.value = "web";
});

const threads = () => demoThreads({ ...emptyChatState(), id: "open", title: "Open" });

function mount(
  onUpdate = vi.fn(async (_id: string, _change: UpdateThreadRequest) => true),
  compactRows = false,
  roster = threads(),
  onSelect = vi.fn(),
) {
  render(
    <ThreadsSidebar
      threads={roster as never}
      currentThreadId="open"
      providers={[]}
      onSelect={onSelect}
      onFork={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={onUpdate}
      onNewTarget={vi.fn()}
      compactRows={compactRows}
    />,
  );
  return onUpdate;
}
const row = (title: string) => screen.getByText(title).closest<HTMLElement>('[role="option"]')!;

test("thread head uses the pane title switcher and grouped labelled new action", () => {
  const onNew = vi.fn(),
    setMode = vi.fn();
  const { container } = render(
    <ThreadPane mode="threads" setMode={setMode} count={9} onNew={onNew}>
      roster
    </ThreadPane>,
  );
  const header = container.querySelector('[data-slot="pane-header"]')!;
  const modes = screen.getByRole("group", { name: "View depth" });
  expect(modes.closest('[data-slot="rail-lead"]')).toBeTruthy();
  expect(header.contains(modes)).toBe(true);
  const action = screen.getByRole("button", { name: "New thread" });
  expect(action.textContent).toBe("new");
  expect(action.closest('[data-slot="rail-actions"] .dl-button-group')).toBeTruthy();
  fireEvent.click(action);
  expect(onNew).toHaveBeenCalledOnce();
  fireEvent.click(within(modes).getByRole("button", { name: "world" }));
  expect(setMode).toHaveBeenCalledWith("world");
});

test("the menu on a selected row acts on every selected thread and greys what needs one", async () => {
  const onUpdate = mount();
  fireEvent.click(row("Draft the BIM handoff notes"), { ctrlKey: true });
  fireEvent.click(row("Check AHU type parameters"), { ctrlKey: true });
  fireEvent.contextMenu(row("Check AHU type parameters"));
  const menu = await screen.findByRole("listbox", { name: "Thread actions" });
  const enabled = (name: RegExp) =>
    within(menu)
      .getAllByRole("option")
      .find((option) => name.test(option.textContent ?? ""))!
      .getAttribute("aria-disabled") !== "true";
  expect(enabled(/^Settle/)).toBe(true);
  expect(enabled(/^Snooze/)).toBe(true);
  expect(enabled(/^Mark unread/)).toBe(true);
  expect(enabled(/^Rename/)).toBe(false);
  expect(enabled(/^Delete/)).toBe(false);
  const rename = within(menu)
    .getAllByRole("option")
    .find((option) => /^Rename/.test(option.textContent ?? ""))!;
  expect(rename.hasAttribute("title")).toBe(false);
  expect(rename.hasAttribute("data-base-ui-tooltip-trigger")).toBe(true);
  expect(menu.textContent).not.toContain("works on one thread");

  fireEvent.click(
    within(menu)
      .getAllByRole("option")
      .find((o) => o.textContent?.startsWith("Settle"))!,
  );
  await waitFor(() => expect(screen.getByText("2 of 2 threads changed")).toBeTruthy());
  expect(onUpdate.mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ["fixture-local", { status: "settled" }],
    ["fixture-family", { status: "settled" }],
  ]);
});

test("plain click activates while modifiers and Space select through the shared list", () => {
  const onSelect = vi.fn();
  mount(undefined, false, threads(), onSelect);
  fireEvent.click(row("Draft the BIM handoff notes"));
  expect(onSelect).toHaveBeenLastCalledWith("fixture-local");
  fireEvent.click(row("Draft the BIM handoff notes"), { metaKey: true });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(row("Draft the BIM handoff notes").getAttribute("aria-selected")).toBe("true");
  const list = screen.getByRole("listbox", { name: "threads" });
  list.focus();
  fireEvent.keyDown(list, { key: " ", code: "Space" });
  expect(row("Draft the BIM handoff notes").getAttribute("aria-selected")).toBe("false");
  fireEvent.keyDown(list, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledTimes(2);
});

test("explicit pills narrow threads and Clear search exposes every shelf", async () => {
  mount();
  const searchRow = screen
    .getByRole("combobox", { name: "Search threads" })
    .closest("[data-list-search]");
  expect(searchRow?.querySelector("[data-list-pill]")?.textContent).toBe("Scope: All");
  fireEvent.click(screen.getByRole("button", { name: "Filter threads" }));
  fireEvent.click(await screen.findByRole("option", { name: /^Filter by Provider/ }));
  const choices = screen.getByRole("listbox", { name: "Filter values" });
  expect(choices.querySelectorAll("[role=option]").length).toBeGreaterThan(0);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Choose Provider" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByText(/Show .*more/)).toBeNull();
  expect(screen.queryByText("No matching threads")).toBeNull();
});

test("drag reorder and shelf drops keep their lifecycle requests", () => {
  const onUpdate = mount();
  const dataTransfer = { getData: () => "fixture-family", setData: vi.fn() };
  fireEvent.drop(row("Draft the BIM handoff notes"), { dataTransfer });
  expect(onUpdate).toHaveBeenLastCalledWith(
    "fixture-family",
    expect.objectContaining({ status: "active", pinned: false, order: expect.any(Number) }),
  );
  const pinned = screen.getByRole("region", { name: "Pinned" });
  fireEvent.drop(pinned, { dataTransfer });
  expect(onUpdate).toHaveBeenLastCalledWith("fixture-family", {
    pinned: true,
    order: expect.any(Number),
  });
});

test("changing the current thread reveals an offscreen row among 355 without replacing an addressed filter", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(355 * 400);
  const base = threads().find((thread) => thread.id === "fixture-local")!;
  const roster = Array.from({ length: 355 }, (_, index) => ({
    ...base,
    id: `thread-${index}`,
    title: `Thread ${index}`,
    providerId: index === 354 ? "other" : "codex",
    lifecycle: { ...base.lifecycle, order: index },
  }));
  const onAddressChange = vi.fn();
  const props = {
    threads: roster as never,
    providers: [],
    onSelect: vi.fn(),
    onFork: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onUpdate: vi.fn(async () => true),
    onNewTarget: vi.fn(),
  };
  const address = { search: threadSearchDefault(), sort: "" as const, onChange: onAddressChange };
  const { rerender } = render(
    <ThreadsSidebar {...props} currentThreadId="thread-0" address={address} />,
  );
  expect(screen.getAllByRole("option").length).toBeLessThan(355);
  expect(screen.queryByText("Thread 354")).toBeNull();
  const scroll = vi.mocked(HTMLElement.prototype.scrollTo);
  const scrolledDown = () =>
    scroll.mock.calls.some(([value]) => {
      const options = value as number | ScrollToOptions;
      return typeof options === "object" && (options.top ?? 0) > 0;
    });
  scroll.mockClear();
  rerender(<ThreadsSidebar {...props} currentThreadId="thread-354" address={address} />);
  await waitFor(() => expect(scrolledDown()).toBe(true));
  expect(
    screen.getByRole("listbox", { name: "threads" }).getAttribute("aria-activedescendant"),
  ).toContain("thread-354");
  expect(onAddressChange).not.toHaveBeenCalled();

  const filtered = { ...address, search: search("", { provider: "codex" }) };
  rerender(<ThreadsSidebar {...props} currentThreadId="thread-0" address={filtered} />);
  scroll.mockClear();
  rerender(<ThreadsSidebar {...props} currentThreadId="thread-354" address={filtered} />);
  expect(screen.getByRole("combobox", { name: "Search threads" }).getAttribute("value")).toBe("");
  expect(screen.queryByText("Thread 354")).toBeNull();
  expect(onAddressChange).not.toHaveBeenCalled();
  expect(scrolledDown()).toBe(false);

  rerender(<ThreadsSidebar {...props} currentThreadId="thread-0" address={address} />);
  const settled = roster.map((thread, index) =>
    index === 354
      ? {
          ...thread,
          lifecycle: { ...thread.lifecycle, status: "settled" as const },
        }
      : thread,
  );
  rerender(
    <ThreadsSidebar
      {...props}
      threads={settled as never}
      currentThreadId="thread-354"
      address={address}
    />,
  );
  expect(
    screen
      .getByRole("region", { name: "Settled" })
      .querySelector("button")
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    screen.getByRole("listbox", { name: "threads" }).getAttribute("aria-activedescendant"),
  ).toContain("thread-354");
  expect(onAddressChange).not.toHaveBeenCalled();
});
