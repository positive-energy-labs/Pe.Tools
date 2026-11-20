// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Roster } from "./calc/view.tsx";
import { SubjectDoor } from "@pe/web-kernel/shell/subject";
import fixture from "@pe/ducts-web/fixtures/fan-sheet.json";
import { ductsRosterResponseSchema } from "@pe/fans-contract/calc-read";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([0, 112])(
  "F3/F4 roster with %i ports exposes search and admits only bounded All",
  (size) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const rows = ductsRosterResponseSchema.parse(fixture.roster).rows;
    const door = {
      all: vi.fn(),
      clear: vi.fn(),
      toggle: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      select: vi.fn(),
      setActive: vi.fn(),
    };
    render(
      <SubjectDoor value={door}>
        <Roster
          props={{
            roster: Array.from({ length: size }, (_, portIndex) => ({
              ...rows[0]!,
              portIndex,
            })),
            picked: [],
            nameOf: String,
            open: vi.fn(),
            busy: false,
            loading: false,
          }}
        />
      </SubjectDoor>,
    );
    expect(screen.getByRole("combobox", { name: "Search fans" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All fans" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear fans" }));
    expect(door.all).toHaveBeenCalledTimes(size === 0 ? 1 : 0);
    if (size)
      expect(screen.getByText("Open up to 8 fan ports at a time from the roster.")).toBeTruthy();
    expect(door.clear).toHaveBeenCalledTimes(1);
  },
);

test("F3 keyboard selection still opens a fan through the roster's subject door", () => {
  const open = vi.fn();
  render(
    <Roster
      props={{
        roster: ductsRosterResponseSchema.parse(fixture.roster).rows.slice(0, 2),
        picked: [],
        nameOf: String,
        open,
        busy: false,
        loading: false,
      }}
    />,
  );
  const list = screen.getByRole("listbox", { name: "fans" });
  list.focus();
  fireEvent.keyDown(list, { key: "ArrowDown" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
});
