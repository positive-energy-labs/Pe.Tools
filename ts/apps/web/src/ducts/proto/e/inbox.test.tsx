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
const handle = (refusal: string | null, label = "x"): ActionHandle =>
  ({ label, refusal, count: null, run: vi.fn(async () => null) }) as unknown as ActionHandle;

function mount(
  over: {
    held?: string | null;
    apply?: string | null;
    onFocusCell?: (c: CellRef) => void;
    healRefusal?: string | null;
    review?: ReviewLine[];
    set?: InboxItem[];
    diagnostics?: InboxItem[];
    store?: Parameters<typeof Inbox>[0]["work"]["store"];
    fanRefusal?: string | null;
    selected?: number | null;
    diagnostic?: { kind: string; pick: (kind: string) => void };
  } = {},
) {
  const apply = handle(over.apply ?? null, "write 3 to Revit");
  const heal = { preview: handle(null), apply: handle(null), busy: false };
  const fan = { preview: handle(null), apply: handle(null), busy: false };
  const pair = { unitId: 17, systemId: 19 };
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
            label: "preview heal",
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
      item({
        key: "f1",
        group: "fix",
        title: "No duct path to a fan",
        verbs: [
          {
            kind: "fan",
            ...pair,
            mode: "preview",
            label: "preview: make FC-17 the fan of SA 19",
            says: "Preview in Revit, rolled back",
            refusal: null,
            outcome: null,
          },
          {
            kind: "fan",
            ...pair,
            mode: "apply",
            label: "make FC-17 the fan of SA 19",
            says: "Make it the fan",
            refusal: over.fanRefusal === undefined ? "Preview it first" : over.fanRefusal,
            outcome: null,
          },
        ],
      }),
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
        preview: handle(null, "preview"),
        apply,
        busy: false,
        row: {
          title: "Write to Revit",
          status: "preview out of date",
          held: over.held ?? null,
        },
        review: over.review ?? [],
      }}
      heal={heal}
      fan={fan}
      selected={over.selected ?? null}
      diagnostic={over.diagnostic ?? { kind: "", pick: () => {} }}
    />,
  );
  return { ...utils, apply, heal, fan, write };
}

test("a Heal row previews with its group, and heals only once a preview armed it", () => {
  const first = mount();
  fireEvent.click(screen.getByText("Heal SA 1: 2 caps"));
  const detail = first.container.querySelector('[data-inbox-detail="heal:g1"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "preview heal" }));
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

test("a no-fan row previews making its one unit the fan, and applies only once a preview armed it", () => {
  const first = mount();
  fireEvent.click(screen.getByText("No duct path to a fan"));
  const detail = first.container.querySelector('[data-inbox-detail="f1"]') as HTMLElement;
  fireEvent.click(
    within(detail).getByRole("button", { name: "preview: make FC-17 the fan of SA 19" }),
  );
  expect(first.fan.preview.run).toHaveBeenCalledWith({ unitId: 17, systemId: 19 });
  const refused = within(detail).getByRole("button", { name: "make FC-17 the fan of SA 19" });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(first.fan.apply.run).not.toHaveBeenCalled();
  cleanup();
  const armed = mount({ fanRefusal: null });
  fireEvent.click(screen.getByText("No duct path to a fan"));
  const open = armed.container.querySelector('[data-inbox-detail="f1"]') as HTMLElement;
  fireEvent.click(within(open).getByRole("button", { name: "make FC-17 the fan of SA 19" }));
  expect(armed.fan.apply.run).toHaveBeenCalledWith({ unitId: 17, systemId: 19 });
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

test("the Write row's apply wears the handle's word and refusal, the same button the head draws", () => {
  const refusedMount = mount({ apply: "Preview first" });
  const refused = within(
    refusedMount.container.querySelector('[data-inbox-group="write"]') as HTMLElement,
  ).getByRole("button", { name: "write 3 to Revit" });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(refusedMount.apply.run).not.toHaveBeenCalled();
  cleanup();
  // Fix and Set rows standing hold back only the ESP: apply stays armed and the row says what waits.
  const held = "1 staged ESP left out of this write: 1 to fix before the ESP writes";
  const armed = mount({ held });
  const group = armed.container.querySelector('[data-inbox-group="write"]') as HTMLElement;
  fireEvent.click(within(group).getByRole("button", { name: "write 3 to Revit" }));
  expect(armed.apply.run).toHaveBeenCalledTimes(1);
  expect(armed.container.querySelector("[data-inbox-write-held]")?.textContent).toBe(held);
});

test("the Write group lists every planned change, old to new, and each refusal", () => {
  const { container } = mount({
    review: [
      {
        key: "a",
        element: "Grille 30",
        what: "airflow",
        from: "none",
        to: "'Flow' 234 cfm",
        outcome: "planned",
        reason: null,
      },
      {
        key: "b",
        element: "Pe store",
        what: "terminalFlow slot",
        from: "PE_M_Grd_AirFlow",
        to: "Flow",
        outcome: "planned",
        reason: null,
      },
      {
        key: "c",
        element: "FC-17",
        what: "ESP",
        from: "none",
        to: "—",
        outcome: "refused",
        reason: "neither the instance nor its type has 'X'",
      },
    ],
  });
  const group = container.querySelector('[data-inbox-group="write"]') as HTMLElement;
  expect(within(group).getByText("Grille 30 · airflow")).toBeTruthy();
  expect(within(group).getByText("none → 'Flow' 234 cfm")).toBeTruthy();
  expect(within(group).getByText("PE_M_Grd_AirFlow → Flow")).toBeTruthy();
  expect(
    within(group).getByText("refused: neither the instance nor its type has 'X'"),
  ).toBeTruthy();
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
              {
                slot: "PE_M_Grd_AirFlow",
                label: "PE_M_Grd_AirFlow · instance, shared",
                have: 0,
                of: 1,
              },
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
          {
            kind: "verdict",
            key: "open-end:2:1",
            verdict: "ignore",
            label: "take back",
            says: "Take the ruling back",
            on: true,
          },
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

test("the selected element opens every row that names it, Diagnostics included", () => {
  const { container } = mount({
    selected: 30,
    diagnostics: [
      item({ key: "d1", group: "diagnostics", kind: "join", status: "near-miss", ids: [30] }),
      item({ key: "d2", group: "diagnostics", kind: "loop", ids: [99] }),
    ],
  });
  const lit = [...container.querySelectorAll("[data-selected]")].map((r) =>
    r.getAttribute("data-key"),
  );
  expect(lit).toEqual(["flows:30", "d1"]);
  expect(container.querySelector('[data-inbox-detail="d1"]')).toBeTruthy();
  expect(container.querySelector('[data-inbox-detail="flows:30"]')).toBeTruthy();
  expect(container.querySelector('[data-key="d2"]')).toBeTruthy();
});

test("the Diagnostics key: a chip per kind with its count; a picked chip narrows the rows", () => {
  const pick = vi.fn();
  const diagnostics = [
    item({ key: "d1", group: "diagnostics", kind: "join", status: "near-miss" }),
    item({ key: "d2", group: "diagnostics", kind: "join", status: "stretched" }),
    item({ key: "d3", group: "diagnostics", kind: "join", status: "stretched" }),
    item({ key: "d4", group: "diagnostics", kind: "loop", status: "priced as a tree" }),
  ];
  const { container } = mount({ diagnostics, diagnostic: { kind: "", pick } });
  const legend = container.querySelector('[data-inbox-legend="diagnostics"]') as HTMLElement;
  expect(
    within(legend)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["near-miss 1", "stretched 2", "loop 1"]);
  fireEvent.click(within(legend).getByRole("button", { name: "stretched 2" }));
  expect(pick).toHaveBeenCalledWith("stretched");
  cleanup();
  const narrowed = mount({ diagnostics, diagnostic: { kind: "stretched", pick } }).container;
  fireEvent.click(narrowed.querySelector('[data-inbox-group="diagnostics"] [role="button"]')!);
  expect(
    [...narrowed.querySelectorAll('[data-inbox-group="diagnostics"] [data-key]')].map((r) =>
      r.getAttribute("data-key"),
    ),
  ).toEqual(["d2", "d3"]);
});
