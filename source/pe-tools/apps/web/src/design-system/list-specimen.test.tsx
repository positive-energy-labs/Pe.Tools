// @vitest-environment jsdom
/** Every panel of /design-system/list renders its real fixture on the one row. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import {
  COMMANDS,
  FieldOptionsPanel,
  LadderPanel,
  MEMBERS,
  PalettePanel,
  PickListPanel,
  SidebarPanel,
  SlashPanel,
  TablePanel,
  THREADS,
  ZONES,
  ZonesPanel,
} from "./list-specimen";

afterEach(cleanup);
const say = vi.fn();
const options = () => document.querySelectorAll('[role="option"]').length;

test("the inline kinds draw every fixture item on the one row", () => {
  for (const [Panel, count] of [
    [SidebarPanel, THREADS.length],
    [PalettePanel, THREADS.length],
    [PickListPanel, MEMBERS.length],
    [ZonesPanel, ZONES.length],
  ] as const) {
    render(<Panel say={say} />);
    expect(options()).toBe(count);
    expect(document.querySelectorAll(".dl-row").length).toBeGreaterThanOrEqual(count);
    cleanup();
  }
});

test("the ladder's unread sessions are refused with their reason", () => {
  render(<LadderPanel say={say} />);
  const refused = [...document.querySelectorAll('[aria-disabled="true"]')].map(
    (r) => r.textContent,
  );
  expect(refused.some((text) => text?.includes("still reading"))).toBe(true);
  expect(refused.some((text) => text?.includes("could not be read"))).toBe(true);
});

test("the field-option popup reads, then lists, with the stale value refused", async () => {
  vi.useFakeTimers();
  render(<FieldOptionsPanel say={say} />);
  await act(async () => fireEvent.click(screen.getByText(/unavailable/)));
  expect(screen.getByRole("status").textContent).toBe("reading…");
  await act(async () => vi.advanceTimersByTime(1000));
  vi.useRealTimers();
  expect(document.body.textContent).toContain("PE_G___Model");
  expect(document.querySelector('[aria-disabled="true"]')?.textContent).toContain(
    "not in the model now",
  );
});

test("the slash menu opens on / and filters by the composer's own text", async () => {
  render(<SlashPanel say={say} />);
  const area = screen.getByLabelText("composer");
  await act(async () => fireEvent.change(area, { target: { value: "/pr" } }));
  await vi.waitFor(() => expect(options()).toBe(1));
  expect(document.body.textContent).toContain(COMMANDS.find((c) => c.key === "prove")!.label);
});

test("the table draws Row as tr; click and shift-click select over the shown order", () => {
  render(<TablePanel say={say} />);
  const rows = document.querySelectorAll<HTMLElement>("tr.dl-row");
  expect(rows.length).toBeGreaterThan(1);
  fireEvent.click(rows[0]!);
  fireEvent.click(rows[rows.length - 1]!, { shiftKey: true });
  expect(document.querySelectorAll('tr.dl-row[aria-selected="true"]').length).toBe(rows.length);
  expect(document.body.textContent).toContain(`${rows.length} selected`);
});
