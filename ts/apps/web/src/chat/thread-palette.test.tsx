// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { UpdateThreadRequest } from "@pe/agent-contracts";
import { emptyChatState } from "#/workbench/chat-state";
import { demoThreads } from "./thread-navigation";
import { ThreadDialog, ThreadsSidebar } from "./thread-palette";

afterEach(cleanup);

const threads = () => demoThreads({ ...emptyChatState(), id: "open", title: "Open" });

function mount(
  onUpdate = vi.fn(async (_id: string, _change: UpdateThreadRequest) => true),
  compactRows = false,
) {
  render(
    <ThreadsSidebar
      threads={threads() as never}
      currentThreadId="open"
      providers={[]}
      onSelect={vi.fn()}
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
const row = (title: string) =>
  screen.getByText(title).closest<HTMLElement>("[data-navigation-item] .dl-row")!;

function expectTimeBeforeProvider(element: HTMLElement) {
  const trail = element.querySelector(".pe-thread-trail")!;
  const time = trail.querySelector("time")!;
  const provider = trail.querySelector("[data-provider]")!;
  expect(time.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trail.querySelectorAll("[data-provider]")).toHaveLength(1);
}

test("compact sidebar keeps its target and places provider after the time", () => {
  mount(
    vi.fn(async () => true),
    true,
  );
  const item = row("Check AHU type parameters");
  expect(item.closest("[data-thread-rows]")?.getAttribute("data-thread-rows")).toBe("compact");
  expectTimeBeforeProvider(item);
  const target = item.querySelector(".pe-thread-target")!;
  expect(target.textContent).toBe("Air Handling Unit.rfa");
  expect(target.getAttribute("title")).toBe("C:/Families/Air Handling Unit.rfa");
  expect(item.querySelectorAll("[data-provider]")).toHaveLength(1);
});

test("full web sidebar retains the original two-line target and provider layout", () => {
  mount();
  const item = row("Check AHU type parameters");
  expect(item.closest("[data-thread-rows]")).toBeNull();
  expect(item.getAttribute("data-lines")).toBe("2");
  expect(item.querySelector(".pe-thread-trail")).toBeNull();
  expect(item.querySelector(".dl-row-sub [data-provider]")).toBeTruthy();
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
  expect(rename.title).toBe("Rename works on one thread; 2 are selected");
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

const selectedRows = () => document.querySelectorAll(".dl-row[data-selected]").length;

test("sidebar search finds a renamed thread by partial immutable ID", () => {
  mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "fixture-local" } });
  expect(screen.getByText("Draft the BIM handoff notes")).toBeTruthy();
  expect(screen.queryByText("Trace the supply air path")).toBeNull();
});

test("Ctrl K thread dialog finds a renamed thread by full ID and selects that exact ID", async () => {
  const id = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
  const onSelect = vi.fn();
  render(
    <ThreadDialog
      threads={demoThreads({ ...emptyChatState(), id, title: "Renamed thread" }) as never}
      currentThreadId={id}
      open
      onOpenChange={vi.fn()}
      onSelect={onSelect}
      onNew={vi.fn()}
      providers={[]}
      onFork={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn(async () => true)}
      onNewTarget={vi.fn()}
    />,
  );
  const search = await screen.findByPlaceholderText("Search every thread");
  const targetRow = screen.getByRole("option", { name: /Check AHU type parameters/ });
  expectTimeBeforeProvider(targetRow);
  expect(targetRow.querySelector(".pe-thread-target")?.textContent).toBe("Air Handling Unit.rfa");
  expect(targetRow.querySelector(".dl-row-sub")).toBeNull();
  expect(targetRow.querySelector(".dl-row-lead")).toBeNull();
  fireEvent.change(search, { target: { value: id } });
  const option = screen.getByRole("option", { name: /Renamed thread/ });
  expect(screen.queryByRole("option", { name: /Trace the supply air path/ })).toBeNull();
  fireEvent.click(option);
  expect(onSelect).toHaveBeenCalledWith(id);
});

test("ctrl-click toggles a row out, a plain click opens and clears, Escape and empty space clear", () => {
  mount();
  const a = row("Draft the BIM handoff notes");
  const b = row("Check AHU type parameters");
  fireEvent.click(a, { ctrlKey: true });
  fireEvent.click(b, { ctrlKey: true });
  expect(selectedRows()).toBe(2);
  fireEvent.click(a, { ctrlKey: true });
  expect(selectedRows()).toBe(1);
  expect(a.hasAttribute("data-selected")).toBe(false);

  fireEvent.click(a, { metaKey: true });
  expect(selectedRows()).toBe(2);
  fireEvent.keyDown(a, { key: "Escape" });
  expect(selectedRows()).toBe(0);
  expect(screen.queryByText(/selected$/)).toBeNull();

  fireEvent.click(a, { ctrlKey: true });
  fireEvent.click(document.querySelector("[data-navigation-roster]")!);
  expect(selectedRows()).toBe(0);

  fireEvent.click(a, { ctrlKey: true });
  fireEvent.click(b, { ctrlKey: true });
  fireEvent.click(row("Trace the supply air path"));
  expect(selectedRows()).toBe(0);

  fireEvent.click(a, { ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(selectedRows()).toBe(0);
});
