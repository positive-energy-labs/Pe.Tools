import { designOf } from "@pe/ducts-domain/test-design";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { ductClaimSchema } from "@pe/agent-contracts";

import { focusRow, inboxRows, type CellRef, type InboxItem } from "../../inbox-rows";
import { cellFocus } from "../../inbox-rows";
import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";
import { Inbox } from "./inbox";

afterEach(cleanup);

test("D18 requires a short claim title and keeps its sentence in the Evidence hint", async () => {
  const value = {
    text: "The intake connects to the return plenum.",
    ids: [1, 2],
    state: "assumed" as const,
  };
  expect.soft(ductClaimSchema.safeParse(value).success).toBe(false);
  for (const title of ["", "x".repeat(61)])
    expect(ductClaimSchema.safeParse({ ...value, title }).success).toBe(false);
  const claim = { ...value, title: "Unit and return", id: "c1", at: value.ids };
  const { check } = inboxRows({
    snapshot: { nodes: [], segments: [], groups: [] },
    scope: null,
    findings: [],
    doc: null,
    flows: new Map(),
    equipmentFlows: new Map(),
    claims: [claim],
    write: { edit: 0, esp: 0 },
  });
  mount({ check, focused: "claim:c1" });
  const row = document.querySelector<HTMLElement>('[data-key="claim:c1"]')!;
  expect(within(row).getByText(claim.title)).toBeTruthy();
  expect(screen.queryByText(value.text)).toBeNull();
  fireEvent.click(row);
  const detail = await waitFor(() => {
    const node = document.querySelector<HTMLElement>('[data-inbox-detail="claim:c1"]');
    expect(node).not.toBeNull();
    return node!;
  });
  const hint = within(detail).getByRole("button", { name: "What is this?" });
  fireEvent.pointerEnter(hint, { pointerType: "mouse" });
  fireEvent.mouseEnter(hint);
  fireEvent.mouseMove(hint);
  expect(
    within(await screen.findByRole("tooltip")).getByText(value.text, { exact: false }),
  ).toBeTruthy();
});

const item = (over: Partial<InboxItem> & Pick<InboxItem, "key" | "group">): InboxItem => ({
  kind: "x",
  title: over.key,
  status: "s",
  ids: [],
  note: null,
  verbs: [],
  ...over,
});
function mount(
  over: {
    held?: string | null;
    onFocusCell?: (c: CellRef) => void;
    set?: InboxItem[];
    diagnostics?: InboxItem[];
    store?: Parameters<typeof Inbox>[0]["work"]["store"];
    selected?: number | null;
    focused?: string | null;
    onPick?: () => void;
    doc?: Parameters<typeof Inbox>[0]["work"]["doc"];
    check?: InboxItem[];
    address?: Parameters<typeof Inbox>[0]["address"];
  } = {},
) {
  const heal = { render: (_row: unknown) => <span>Heal control</span> };
  const fan = { render: (_row: unknown) => <span>Fan control</span> };
  const pair = { unitId: 17, systemId: 19 };
  const write = vi.fn(async (_patches: unknown) => null);
  const groups = {
    fix: [
      item({
        key: "heal:g1",
        group: "fix",
        kind: "heal",
        title: "Heal SA 1: 2 caps",
        status: "3 edit",
        ids: [10],
        verbs: [
          {
            kind: "command",
            on: { verb: "heal", group: "g1" },
            label: "Heal",
            says: "Review repairs, then heal",
          },
        ],
      }),
      item({
        key: "f1",
        group: "fix",
        title: "No duct path to a fan",
        verbs: [
          {
            kind: "command",
            on: { verb: "fan", ...pair },
            label: "Assign fan",
            says: "Review the assignment, then apply it",
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
      work={{ doc: over.doc ?? null, revision: 0, write, store: over.store ?? null }}
      nameOf={String}
      onVerdict={null}
      onSelect={() => {}}
      onFocusCell={over.onFocusCell ?? (() => {})}
      write={{
        control: <span>Price control</span>,
        row: { title: "Write to Revit", status: "edit", held: over.held ?? null },
      }}
      cells={() => <span>Cell controls</span>}
      heal={heal}
      fan={fan}
      selected={over.selected ?? null}
      focused={over.focused ?? null}
      onPick={over.onPick ?? (() => {})}
      address={over.address}
    />,
  );
  return { ...utils, heal, fan, write };
}

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
    { path: ["assumptions", "open-end:2:1", "edit"], value: { delete: true } },
  ]);
});

// The chat head's "→ review" on a edit cell: the cell family's `focus` writes `issue`, the screen
// resolves it with `focusRow` against the inbox's rows, and the Inbox opens and selects that row.
const reviewPage = (segment: string, key: string) => {
  return { selected: cellFocus(segment, key) };
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

test("review on a edit rule with no row of its own lands on the Write row", () => {
  const { selected: issue } = reviewPage("rules", "elbow-1d-le10") as { selected: string };
  const focused = focusRow(issue, rowKeysOf({}));
  expect(focused).toBe("write");
  const { container } = mount({ focused });
  const row = container.querySelector('[data-key="write"]') as HTMLElement;
  expect(row.hasAttribute("data-selected")).toBe(true);
  expect(container.querySelectorAll("[data-selected]")).toHaveLength(1);
});

test("review on a proposed rule lands on that cell's own row, opened", async () => {
  const check = [
    item({
      key: "rules:elbow-1d-le10",
      group: "check",
      kind: "suggestion",
      title: "Rule · Round Elbow : 1 D",
      verbs: [],
    }),
  ];
  const { selected: issue } = reviewPage("rules", "elbow-1d-le10") as { selected: string };
  const focused = focusRow(issue, rowKeysOf({ check }));
  expect(focused).toBe("rules:elbow-1d-le10");
  const { container } = mount({ focused, check });
  const row = container.querySelector('[data-key="rules:elbow-1d-le10"]') as HTMLElement;
  expect(row.hasAttribute("data-selected")).toBe(true);
  fireEvent.click(row);
  await waitFor(() =>
    expect(container.querySelector('[data-inbox-detail="rules:elbow-1d-le10"]')).not.toBeNull(),
  );
});

test("an issue id that names no Work cell lands nowhere extra", () => {
  expect(focusRow("open-end:2:1", new Set(["f1"]))).toBeNull();
  expect(focusRow("", new Set(["f1"]))).toBeNull();
  // A edit verdict's cell is keyed by its issue id; its row is the issue's own.
  expect(focusRow("assumptions:open-end:2:1", new Set(["open-end:2:1"]))).toBe("open-end:2:1");
});

test("a loss-rule group reads as its family, type and condition", () => {
  const family = {
    label: (key: string) => {
      const rule = ruleByKey(key);
      return rule ? ruleWords(rule) : key;
    },
  };
  expect(family.label!("elbow-1d-le10")).toBe("Round Elbow 1 D · D ≤ 10 in");
  expect(family.label!("not-a-rule")).toBe("not-a-rule");
});

test("picking another ruling opens its details without owning Page selection", () => {
  const { container } = mount({
    selected: 10,
    check: [
      item({ key: "same-element", group: "check", title: "Another ruling for 10", ids: [10] }),
    ],
  });
  fireEvent.click(screen.getByText("Another ruling for 10"));
  expect(container.querySelector('[data-inbox-detail="same-element"]')).not.toBeNull();
  expect(container.querySelector('[data-inbox-detail="heal:g1"]')).toBeNull();
  expect(container.querySelector('[data-key="same-element"]')?.getAttribute("aria-selected")).toBe(
    "false",
  );
});

test("open findings keep compact state and actions, with full evidence in focusable help", async () => {
  mount({
    diagnostics: [
      item({
        key: "missed:10:20",
        group: "diagnostics",
        kind: "missed-join",
        title: "Open ends 4.0 inches apart: 10 and 20",
        status: "possible missed join",
        ids: [10, 20],
        note: "Facing open ends need inspection in Revit.",
        verbs: [{ kind: "select", ids: [10, 20] }],
      }),
    ],
    focused: "missed:10:20",
  });
  const row = document.querySelector<HTMLElement>('[data-key="missed:10:20"]')!;
  expect(within(row).getByText("Open ends 4.0 inches apart: 10 and 20")).toBeTruthy();
  expect(within(row).getByText("missed join?")).toBeTruthy();
  const detail = document.querySelector<HTMLElement>('[data-inbox-detail="missed:10:20"]')!;
  expect(within(detail).getByText("Evidence")).toBeTruthy();
  expect(screen.queryByText("possible missed join")).toBeNull();
  expect(screen.queryByText("Facing open ends need inspection in Revit.")).toBeNull();
  expect(row.getAttribute("data-revit-ids")).toBe("10,20");
  expect(within(row).getByRole("button", { name: /select/i })).toBeTruthy();
  fireEvent.focus(within(detail).getByRole("button", { name: "What is this?" }));
  const help = await screen.findByRole("tooltip");
  expect(within(help).getByText("possible missed join")).toBeTruthy();
  expect(
    within(help).getByText("Facing open ends need inspection in Revit.", { exact: false }),
  ).toBeTruthy();
});

test("a person's row pick carries its identity, while automatic reveal does not pick", () => {
  const onPick = vi.fn();
  const view = mount({ focused: "flows:30", onPick });
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.click(view.container.querySelector('[data-key="flows:30"]')!);
  expect(onPick).toHaveBeenLastCalledWith("flows:30");
  fireEvent.click(screen.getByText("Write to Revit"));
  expect(onPick).toHaveBeenLastCalledWith("write");
});

test("a no-rule row stages a family-wide price-as choice through Work", async () => {
  const family = "Radius Elbow";
  const onPick = vi.fn();
  const view = mount({
    onPick,
    focused: "no-rule:radius",
    diagnostics: [
      item({
        key: "no-rule:radius",
        group: "diagnostics",
        kind: "no-rule",
        ids: [10, 20],
        verbs: [{ kind: "price-as", family }],
      }),
    ],
  });
  const picker = screen.getByRole("combobox", { name: `price ${family} as` });
  fireEvent.click(picker);
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  expect(onPick).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.change(picker, {
      target: { value: "elbow-1d-le10" },
    }),
  );
  expect(view.write).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        path: ["ruleAssignments", family, "edit"],
        value: { value: { rule: "elbow-1d-le10" } },
      }),
    ]),
  );
});

test("taking back a family assignment clears only its edit rung", async () => {
  const family = "Radius Elbow";
  const suggestion = { value: { rule: "elbow-mitered-vaned" }, note: "check the vanes" };
  const doc = designOf({
    ruleAssignments: {
      [family]: { edit: suggestion },
    },
  });
  const view = mount({
    doc,
    focused: "family",
    check: [item({ key: "family", group: "check", verbs: [{ kind: "price-as", family }] })],
  });
  fireEvent.click(view.container.querySelector('[data-key="family"]')!);
  await act(async () =>
    fireEvent.change(await screen.findByRole("combobox", { name: `price ${family} as` }), {
      target: { value: "" },
    }),
  );
  expect(view.write).toHaveBeenCalledWith([
    { path: ["ruleAssignments", family, "edit"], value: null },
  ]);
  expect(doc.ruleAssignments[family]?.edit).toEqual(suggestion);
});

test("blocking input rows carry damage while diagnostic rows stay calm", () => {
  mount({ focused: "d1" });
  expect(document.querySelector('[data-key="flows:30"]')?.getAttribute("data-damage")).toBe(
    "no flow",
  );
  expect(document.querySelector('[data-key="d1"]')?.hasAttribute("data-damage")).toBe(false);
});
