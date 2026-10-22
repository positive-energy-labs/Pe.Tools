// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { UpdateThreadRequest } from "@pe/agent-contracts";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { demoThreads } from "./thread-navigation";
import { ThreadsSidebar } from "./thread-palette";

afterEach(cleanup);

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
) {
  render(
    <ThreadsSidebar
      threads={roster as never}
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
