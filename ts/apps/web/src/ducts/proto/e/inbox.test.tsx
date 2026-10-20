// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ActionHandle } from "#/route/handle";

import type { CellRef, InboxItem } from "../../inbox-rows";
import { Inbox } from "./inbox";

afterEach(cleanup);

const item = (over: Partial<InboxItem> & Pick<InboxItem, "key" | "group">): InboxItem => ({
  kind: "x",
  title: over.key,
  status: "s",
  ids: [],
  note: null,
  verbs: [],
  ...over,
});
const handle = (refusal: string | null): ActionHandle =>
  ({ label: "x", refusal, count: null, run: vi.fn(async () => null) }) as unknown as ActionHandle;

function mount(over: { blocked?: string | null; apply?: string | null; onFocusCell?: (c: CellRef) => void } = {}) {
  const apply = handle(over.apply ?? null);
  const groups = {
    fix: [item({ key: "f1", group: "fix", title: "No duct path to a fan" })],
    set: [
      item({
        key: "flows:30",
        group: "set",
        title: "Grille 30",
        status: "no flow",
        ids: [30],
        verbs: [
          {
            kind: "focus",
            cell: { segment: "flows", id: 30 },
            label: "enter a flow",
            says: "Select the terminal and enter its design flow",
          },
        ],
      }),
    ],
    check: [],
    diagnostics: [item({ key: "d1", group: "diagnostics", title: "near join", status: "near-miss" })],
  };
  const utils = render(
    <Inbox
      groups={groups}
      work={{ doc: null, revision: 0, write: async () => null }}
      doc={null}
      nameOf={String}
      onVerdict={null}
      light={() => {}}
      onSelect={() => {}}
      onFocusCell={over.onFocusCell ?? (() => {})}
      write={{
        preview: handle(null),
        apply,
        busy: false,
        row: {
          title: "Write to Revit",
          status: "preview out of date",
          blocked: over.blocked ?? null,
        },
      }}
    />,
  );
  return { ...utils, apply };
}

test("groups draw Fix, Set, Write in loop order with Diagnostics collapsed last", () => {
  const { container } = mount();
  const order = [...container.querySelectorAll("[data-inbox-group]")].map((g) =>
    g.getAttribute("data-inbox-group"),
  );
  expect(order).toEqual(["fix", "set", "write", "diagnostics"]);
  expect(screen.queryByText("near join")).toBeNull();
  fireEvent.click(container.querySelector('[data-inbox-group="diagnostics"] [role="button"]')!);
  expect(screen.getByText("near join")).toBeTruthy();
});

test("a Set row's verb deep-links to its cell on the tree", () => {
  const onFocusCell = vi.fn();
  const { container } = mount({ onFocusCell });
  fireEvent.click(screen.getByText("Grille 30"));
  const detail = container.querySelector('[data-inbox-detail="flows:30"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "enter a flow" }));
  expect(onFocusCell).toHaveBeenCalledWith({ segment: "flows", id: 30 });
});

test("the Write row's apply is refused with what remains, and armed when nothing does", () => {
  const blocked = mount({ blocked: "1 to fix and 1 to set before writing" });
  const refused = within(blocked.container.querySelector('[data-inbox-group="write"]') as HTMLElement).getByRole(
    "button",
    { name: /write to Revit/ },
  );
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(blocked.apply.run).not.toHaveBeenCalled();
  cleanup();
  const armed = mount();
  const write = within(armed.container.querySelector('[data-inbox-group="write"]') as HTMLElement).getByRole(
    "button",
    { name: /write to Revit/ },
  );
  fireEvent.click(write);
  expect(armed.apply.run).toHaveBeenCalledTimes(1);
});
