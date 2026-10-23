// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ActionHandle } from "#/route/handle";

import { focusRow, type CellRef, type InboxItem } from "../../inbox-rows";
import { manifest } from "../../manifest";
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
    focused?: string | null;
    check?: InboxItem[];
    address?: Parameters<typeof Inbox>[0]["address"];
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
    check: over.check ?? [],
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
      focused={over.focused ?? null}
      address={over.address}
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

test("the Write row's apply wears the handle's word and refusal, the same button the head draws", () => {
  const refusedMount = mount({ apply: "Preview first" });
  const refused = within(
    refusedMount.container.querySelector('[aria-label="Write"]') as HTMLElement,
  ).getByRole("button", { name: "write 3 to Revit" });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(refusedMount.apply.run).not.toHaveBeenCalled();
  cleanup();
  // Fix and Set rows standing hold back only the ESP: apply stays armed and the row says what waits.
  const held = "1 staged ESP left out of this write: 1 to fix before the ESP writes";
  const armed = mount({ held });
  const group = armed.container.querySelector('[aria-label="Write"]') as HTMLElement;
  fireEvent.click(screen.getByText("Write to Revit"));
  fireEvent.click(within(group).getByRole("button", { name: "write 3 to Revit" }));
  expect(armed.apply.run).toHaveBeenCalledTimes(1);
  expect(armed.container.querySelector("[data-inbox-write-held]")?.textContent).toBe(held);
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
  fireEvent.click(container.querySelector('[aria-label="Diagnostics"] button')!);
  fireEvent.click(screen.getByText("Open end at 2"));
  const detail = container.querySelector('[data-inbox-detail="open-end:2:1"]') as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: "take back" }));
  expect(write).toHaveBeenCalledWith([
    { path: ["assumptions", "open-end:2:1", "staged"], value: { delete: true } },
  ]);
});

// The chat head's "→ review" on a staged cell: the cell family's `focus` writes `issue`, the screen
// resolves it with `focusRow` against the inbox's rows, and the Inbox opens and selects that row.
const reviewPage = (segment: string, key: string) => {
  const family = manifest.cells!.find((one) => one.segment === segment)!;
  return family.focus!(key);
};
const rowKeysOf = (over: NonNullable<Parameters<typeof mount>[0]>) =>
  new Set([
    "heal:g1",
    "f1",
    "flows:30",
    "d1",
    ...(over.set ?? []).map((i) => i.key),
    ...(over.check ?? []).map((i) => i.key),
  ]);

test("review on a staged rule with no row of its own lands on the Write row", () => {
  const { issue } = reviewPage("rules", "elbow-1d-le10") as { issue: string };
  const focused = focusRow(issue, rowKeysOf({}));
  expect(focused).toBe("write");
  const { container } = mount({ focused });
  const row = container.querySelector('[data-key="write"]') as HTMLElement;
  expect(row.hasAttribute("data-selected")).toBe(true);
  expect(container.querySelectorAll("[data-selected]")).toHaveLength(1);
});

test("review on a proposed rule lands on that cell's own row, opened", () => {
  const check = [
    item({
      key: "rules:elbow-1d-le10",
      group: "check",
      kind: "proposal",
      title: "Rule · Round Elbow : 1 D",
      verbs: [],
    }),
  ];
  const { issue } = reviewPage("rules", "elbow-1d-le10") as { issue: string };
  const focused = focusRow(issue, rowKeysOf({ check }));
  expect(focused).toBe("rules:elbow-1d-le10");
  const { container } = mount({ focused, check });
  const row = container.querySelector('[data-key="rules:elbow-1d-le10"]') as HTMLElement;
  expect(row.hasAttribute("data-selected")).toBe(true);
  expect(container.querySelector('[data-inbox-detail="rules:elbow-1d-le10"]')).not.toBeNull();
});

test("an issue id that names no Work cell lands nowhere extra", () => {
  expect(focusRow("open-end:2:1", new Set(["f1"]))).toBeNull();
  expect(focusRow("", new Set(["f1"]))).toBeNull();
  // A staged verdict's cell is keyed by its issue id; its row is the issue's own.
  expect(focusRow("assumptions:open-end:2:1", new Set(["open-end:2:1"]))).toBe("open-end:2:1");
});

test("a loss-rule group reads as its family, type and condition", () => {
  const family = manifest.cells!.find((one) => one.segment === "rules")!;
  expect(family.label!("elbow-1d-le10")).toBe("Round Elbow 1 D · D ≤ 10 in");
  expect(family.label!("not-a-rule")).toBe("not-a-rule");
});

test("Rulings use counted query facets and stage marks without replacing an excluding address", () => {
  const onChange = vi.fn();
  const { container } = mount({
    focused: "rules:one",
    check: [
      item({ key: "rules:one", group: "check", kind: "proposal", title: "Proposed elbow rule" }),
    ],
    address: { query: "kind=heal", sort: "name", onChange },
  });
  expect(screen.queryByText("Proposed elbow rule")).toBeNull();
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Search rulings" }), {
    target: { value: "kind=proposal sort:name" },
  });
  expect(onChange).toHaveBeenCalledWith("kind=proposal sort:name", "name");
  cleanup();
  const staged = mount({
    check: [
      item({ key: "rules:one", group: "check", kind: "proposal", title: "Proposed elbow rule" }),
    ],
    review: [
      {
        key: "review:one",
        element: "Elbow 30",
        what: "loss",
        from: "1",
        to: "2",
        outcome: "would-write",
        reason: null,
      },
    ],
  });
  expect(staged.container.querySelector('[data-key="rules:one"]')?.getAttribute("data-stage")).toBe(
    "proposed",
  );
  expect(
    staged.container.querySelector('[data-key="review:one"]')?.getAttribute("data-stage"),
  ).toBe("staged");
});
