// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ActionHandle } from "#/route/handle";

import type { CellRef, InboxItem } from "../../inbox-rows";
import type { ReviewLine } from "../../write-review";
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

function mount(
  over: {
    blocked?: string | null;
    apply?: string | null;
    onFocusCell?: (c: CellRef) => void;
    healRefusal?: string | null;
    review?: ReviewLine[];
    set?: InboxItem[];
    diagnostics?: InboxItem[];
    store?: Parameters<typeof Inbox>[0]["work"]["store"];
  } = {},
) {
  const apply = handle(over.apply ?? null);
  const heal = { preview: handle(null), apply: handle(null), busy: false };
  const write = vi.fn(async (_patches: unknown) => null);
  const groups = {
    fix: [
      item({
        key: "heal:g1",
        group: "fix",
        kind: "heal",
        title: "Heal SA 1: 2 caps",
        status: "not previewed",
        ids: [10],
        verbs: [
          {
            kind: "heal",
            group: "g1",
            mode: "preview",
            label: "preview",
            says: "Preview healing",
            refusal: null,
          },
          {
            kind: "heal",
            group: "g1",
            mode: "apply",
            label: "heal",
            says: "Heal what passed",
            refusal: over.healRefusal === undefined ? "Preview the heal first" : over.healRefusal,
          },
        ],
      }),
      item({ key: "f1", group: "fix", title: "No duct path to a fan" }),
    ],
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
    diagnostics: [
      item({ key: "d1", group: "diagnostics", title: "near join", status: "near-miss" }),
    ],
  };
  if (over.set) groups.set = over.set;
  if (over.diagnostics) groups.diagnostics = over.diagnostics;
  const utils = render(
    <Inbox
      groups={groups}
      work={{ doc: null, revision: 0, write, store: over.store ?? null }}
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
        review: over.review ?? [],
      }}
      heal={heal}
    />,
  );
  return { ...utils, apply, heal, write };
}

test("a Heal row previews with its group, and heals only once a preview armed it", () => {
  const first = mount();
  fireEvent.click(screen.getByText("Heal SA 1: 2 caps"));
  const detail = first.container.querySelector('[data-inbox-detail="heal:g1"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "preview" }));
  expect(first.heal.preview.run).toHaveBeenCalledWith({ group: "g1" });
  const refused = within(detail).getByRole("button", { name: "heal" });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(first.heal.apply.run).not.toHaveBeenCalled();
  cleanup();
  const armed = mount({ healRefusal: null });
  fireEvent.click(screen.getByText("Heal SA 1: 2 caps"));
  const open = armed.container.querySelector('[data-inbox-detail="heal:g1"]') as HTMLElement;
  fireEvent.click(within(open).getByRole("button", { name: "heal" }));
  expect(armed.heal.apply.run).toHaveBeenCalledWith({ group: "g1" });
});

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
  const refused = within(
    blocked.container.querySelector('[data-inbox-group="write"]') as HTMLElement,
  ).getByRole("button", { name: /write to Revit/ });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(blocked.apply.run).not.toHaveBeenCalled();
  cleanup();
  const armed = mount();
  const write = within(
    armed.container.querySelector('[data-inbox-group="write"]') as HTMLElement,
  ).getByRole("button", { name: /write to Revit/ });
  fireEvent.click(write);
  expect(armed.apply.run).toHaveBeenCalledTimes(1);
});

test("the Write group lists every planned change, old to new, and each refusal", () => {
  const { container } = mount({
    review: [
      { key: "a", element: "Grille 30", what: "airflow", from: "none", to: "'Flow' 234 cfm", outcome: "planned", reason: null },
      { key: "b", element: "Pe store", what: "terminalFlow slot", from: "PE_M_Grd_AirFlow", to: "Flow", outcome: "planned", reason: null },
      { key: "c", element: "FC-17", what: "ESP", from: "none", to: "—", outcome: "refused", reason: "neither the instance nor its type has 'X'" },
    ],
  });
  const group = container.querySelector('[data-inbox-group="write"]') as HTMLElement;
  expect(within(group).getByText("Grille 30 · airflow")).toBeTruthy();
  expect(within(group).getByText("none → 'Flow' 234 cfm")).toBeTruthy();
  expect(within(group).getByText("PE_M_Grd_AirFlow → Flow")).toBeTruthy();
  expect(within(group).getByText("refused")).toBeTruthy();
});

test("the airflow row's open choice stages the terminalFlow slot", () => {
  const { container, write } = mount({
    set: [
      item({
        key: "airflow",
        group: "set",
        title: "Airflow from PE_M_Grd_AirFlow",
        ids: [30],
        verbs: [
          {
            kind: "airflow",
            current: "PE_M_Grd_AirFlow",
            options: [
              { slot: "Flow", label: "Flow · instance", have: 1, of: 1 },
              { slot: "PE_M_Grd_AirFlow", label: "PE_M_Grd_AirFlow · instance, shared", have: 0, of: 1 },
            ],
          },
        ],
      }),
    ],
  });
  fireEvent.click(screen.getByText("Airflow from PE_M_Grd_AirFlow"));
  const detail = container.querySelector('[data-inbox-detail="airflow"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "Flow · instance · 1/1" }));
  expect(write).toHaveBeenCalledWith([
    { path: ["parameters", "terminalFlow", "staged"], value: { value: "Flow" } },
  ]);
});

test("taking back a stored ignore stages a delete over it", () => {
  const { container, write } = mount({
    store: {
      version: 2,
      rules: {},
      instances: {},
      terminals: {},
      terminalFlows: {},
      equipmentFlows: {},
      verdicts: { "open-end:2:1": { verdict: "ignore", ruledAt: "2026-10-20T00:00:00Z" } },
      roles: {},
      workRevision: 1,
    },
    diagnostics: [
      item({
        key: "open-end:2:1",
        group: "diagnostics",
        title: "Open end at 2",
        verbs: [
          { kind: "verdict", key: "open-end:2:1", verdict: "ignore", label: "take back", says: "Take the ruling back", on: true },
        ],
      }),
    ],
  });
  fireEvent.click(container.querySelector('[data-inbox-group="diagnostics"] [role="button"]')!);
  fireEvent.click(screen.getByText("Open end at 2"));
  const detail = container.querySelector('[data-inbox-detail="open-end:2:1"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "take back" }));
  expect(write).toHaveBeenCalledWith([
    { path: ["assumptions", "open-end:2:1", "staged"], value: { delete: true } },
  ]);
});
