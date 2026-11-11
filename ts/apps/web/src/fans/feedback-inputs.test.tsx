// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Roster } from "../ducts/sheet/view";
import { SubjectDoor } from "../shell/subject";
import fixture from "../ducts/sheet/sheet.fixture.json";
import { ductsRosterResponseSchema } from "@pe/agent-contracts";

afterEach(cleanup);

test("F3/F4 the roster always exposes search and forwards all/clear as one subject transition", () => {
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
          roster: [],
          picked: [],
          nameOf: String,
          open: vi.fn(),
          finding: { run: vi.fn(), refusal: null },
          busy: false,
          loading: false,
        }}
      />
    </SubjectDoor>,
  );
  expect(screen.getByRole("combobox", { name: "Search fans" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All fans" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear fans" }));
  expect(door.all).toHaveBeenCalledTimes(1);
  expect(door.clear).toHaveBeenCalledTimes(1);
});

test("F3 keyboard selection still opens a fan through the roster's subject door", () => {
  const open = vi.fn();
  render(
    <Roster
      props={{
        roster: ductsRosterResponseSchema.parse(fixture.roster).rows.slice(0, 2),
        picked: [],
        nameOf: String,
        open,
        finding: { run: vi.fn(), refusal: null },
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
