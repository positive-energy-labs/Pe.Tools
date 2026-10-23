// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { UpdateThreadRequest } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { demoThreads } from "./thread-navigation";
import { ThreadsSidebar } from "./thread-palette";

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
      onNew={vi.fn()}
      onSearch={vi.fn()}
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
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("2 of 2 threads changed"),
  );
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

test("table query narrows target, provider, state, unread and Attention and reveals archived shelves", async () => {
  mount();
  const search = screen.getByRole("textbox", { name: "Search threads" });
  fireEvent.change(search, {
    target: { value: "scope=attention state=working provider=codex unread=yes" },
  });
  expect(screen.getAllByRole("option").map((item) => item.getAttribute("data-key"))).toEqual([
    "fixture-running",
  ]);
  fireEvent.change(search, { target: { value: 'scope=archived "Original schedule"' } });
  expect(row("Original schedule exploration")).toBeTruthy();
  expect(screen.queryByText(/Show .*more/)).toBeNull();
  fireEvent.change(search, { target: { value: "scope=attention !state=working no-such-thread" } });
  expect(screen.getByText("No matching threads")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
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
