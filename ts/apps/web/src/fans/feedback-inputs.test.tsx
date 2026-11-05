// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ChoiceCell } from "../ducts/sheet/choice-cell";
import { EspParameter } from "../ducts/sheet/esp-parameter";
import { Roster } from "../ducts/sheet/view";
import { SubjectDoor } from "../shell/subject";
import fixture from "../ducts/sheet/sheet.fixture.json";
import { ductsRosterResponseSchema } from "@pe/agent-contracts";

const live = vi.hoisted(() => ({ state: "ready", result: "Success", read: vi.fn() }));
vi.mock("../shell/readings-hooks", async (original) => ({
  ...(await original<object>()),
  useFieldOptionsReading: (...args: unknown[]) => {
    live.read(...args);
    return {
      state: live.state,
      message: "Disconnected",
      observation: {
        result: { kind: live.result, message: "Unsupported parameter domain" },
        items: [
          {
            value: "shared:esp|instance",
            label: "Available ESP · instance",
            metadata: {
              name: "Available ESP",
              kind: "Shared",
              scope: "instance",
              storageType: "Double",
              dataTypeId: "pressure",
            },
          },
        ],
      },
    };
  },
}));
afterEach(() => {
  cleanup();
  live.state = "ready";
  live.result = "Success";
});

test("F6 an acknowledged role edit renders the option label with its author, never its object", () => {
  const props = {
    label: "Unit role SH-1",
    options: [
      { key: "fan", label: "Fan" },
      { key: "passive", label: "Passive" },
    ],
    current: "passive",
    cell: {},
    path: null,
    show: JSON.stringify,
    refusal: null,
    pick: vi.fn(),
  };
  const view = render(<ChoiceCell {...props} />);
  view.rerender(
    <ChoiceCell
      {...props}
      current="fan"
      cell={{ edit: { value: { role: "fan" }, by: "human" } }}
    />,
  );
  expect(view.container.textContent).toContain("Fan");
  expect(view.container.textContent).not.toContain('{"role"');
  expect(view.container.querySelector('[data-unsaved="human"]')).toBeTruthy();
});

test("F5 live parameter metadata reaches the picker and the slot stages the name, not the identity key", async () => {
  const commit = vi.fn(async () => undefined);
  render(
    <EspParameter
      target={{ session: "s", openId: "d" }}
      units={["u"]}
      cell={{}}
      model="Old ESP"
      transitions={[]}
      commit={commit}
    />,
  );
  expect(live.read).toHaveBeenLastCalledWith(
    { session: "s", openId: "d" },
    "parameter-identities",
    {
      ElementUniqueIds: "u",
      ParameterScope: "instanceThenType",
      StorageType: "Double",
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Old ESP" }));
  expect(await screen.findByText("Shared · Double · pressure")).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: /Available ESP/ }));
  await waitFor(() => expect(commit).toHaveBeenCalledWith("Available ESP"));
});

test.each(["loading", "failed"])("F5 %s options cannot stage a stale choice", (state) => {
  live.state = state;
  const view = render(
    <EspParameter
      target={{ session: "s", openId: "d" }}
      units={["u"]}
      cell={{}}
      model="Old ESP"
      transitions={[]}
      commit={vi.fn()}
    />,
  );
  expect(view.container.querySelector('[data-body="locked"]')).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Old ESP" })).toBeNull();
});

test("F3/F4 the roster always exposes search and forwards all/clear as one subject transition", () => {
  const door = {
    all: vi.fn(),
    clear: vi.fn(),
    toggle: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
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
  render(<Roster props={{ roster: ductsRosterResponseSchema.parse(fixture.roster).rows.slice(0, 2), picked: [], nameOf: String, open, busy: false, loading: false }} />);
  const list = screen.getByRole("listbox", { name: "fans" });
  list.focus();
  fireEvent.keyDown(list, { key: "ArrowDown" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
});
