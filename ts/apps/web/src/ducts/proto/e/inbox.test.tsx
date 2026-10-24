import { emptyListSearch, pickListPill } from "@pe/agent-contracts";
const search = (keywords = "", pills: Record<string, string> = {}) =>
  Object.entries(pills).reduce((s, [field, value]) => pickListPill(s, field, value), {
    ...emptyListSearch(),
    keywords,
  });
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ActionHandle } from "#/route/handle";
import { ductClaimSchema, ductsDocumentSchema } from "@pe/agent-contracts";

import { focusRow, inboxRows, type CellRef, type InboxItem } from "../../inbox-rows";
import { manifest } from "../../manifest";
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
    write: { staged: 0, hasPreview: false, fresh: false, planned: null, refused: null, esp: 0 },
  });
  mount({ check, focused: "claim:c1" });
  const row = document.querySelector<HTMLElement>('[data-key="claim:c1"]')!;
  expect(within(row).getByText(claim.title)).toBeTruthy();
  expect(screen.queryByText(value.text)).toBeNull();
  const detail = document.querySelector<HTMLElement>('[data-inbox-detail="claim:c1"]')!;
  const hint = within(detail).getByRole("button", { name: "What is this?" });
  fireEvent.pointerEnter(hint, { pointerType: "mouse" });
  fireEvent.mouseEnter(hint);
  fireEvent.mouseMove(hint);
  expect(within(await screen.findByRole("tooltip")).getByText(value.text)).toBeTruthy();
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
const handle = (refusal: string | null, label = "x"): ActionHandle =>
  ({ label, refusal, count: null, run: vi.fn(async () => null) }) as unknown as ActionHandle;

function mount(
  over: {
    held?: string | null;
    apply?: string | null;
    onFocusCell?: (c: CellRef) => void;
    healRefusal?: string | null;
    previewed?: boolean;
    healHeld?: boolean;
    fanHeld?: boolean;
    set?: InboxItem[];
    diagnostics?: InboxItem[];
    store?: Parameters<typeof Inbox>[0]["work"]["store"];
    fanRefusal?: string | null;
    selected?: number | null;
    focused?: string | null;
    onPick?: () => void;
    doc?: Parameters<typeof Inbox>[0]["work"]["doc"];
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
            kind: "preview",
            on: { verb: "heal", group: "g1" },
            label: "preview heal",
            says: "Preview healing",
            held: over.healHeld
              ? {
                  word: "heal · previewed 2",
                  summary: "2 pass · 0 refused",
                  lines: [{ key: "cap:1", text: "cap 10 (end 1)", state: "planned", reason: null }],
                }
              : null,
            stale: null,
            commit: {
              label: "apply heal",
              says: "Heal what passed",
              refusal: over.healRefusal === undefined ? null : over.healRefusal,
            },
            outcome: null,
          },
        ],
      }),
      item({
        key: "f1",
        group: "fix",
        title: "No duct path to a fan",
        verbs: [
          {
            kind: "preview",
            on: { verb: "fan", ...pair },
            label: "preview: make FC-17 the fan of SA 19",
            says: "Preview in Revit, rolled back",
            held: over.fanHeld
              ? { word: "make FC-17 the fan of SA 19 · previewed", summary: "planned", lines: [] }
              : null,
            stale: null,
            commit: {
              label: "make FC-17 the fan of SA 19",
              says: "Make it the fan",
              refusal: over.fanRefusal === undefined ? null : over.fanRefusal,
            },
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
      work={{ doc: over.doc ?? null, revision: 0, write, store: over.store ?? null }}
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
        held: over.previewed
          ? {
              word: "previewed 3",
              summary: "3 planned · 1 refused",
              lines: [
                { key: "a", text: "FC-17 · ESP: 0.5 → 0.9", state: "planned", reason: null },
                { key: "b", text: "Pe store · slot", state: "refused", reason: "Revit says no" },
              ],
            }
          : null,
        stale: false,
      }}
      heal={heal}
      fan={fan}
      selected={over.selected ?? null}
      focused={over.focused ?? null}
      onPick={over.onPick ?? (() => {})}
      address={over.address}
    />,
  );
  return { ...utils, apply, heal, fan, write };
}

test("a Heal row previews with its group, then its popover heals what the preview passed", async () => {
  const first = mount();
  fireEvent.click(screen.getByText("Heal SA 1: 2 caps"));
  const detail = first.container.querySelector('[data-inbox-detail="heal:g1"]') as HTMLElement;
  await act(async () =>
    fireEvent.click(within(detail).getByRole("button", { name: "preview heal" })),
  );
  expect(first.heal.preview.run).toHaveBeenCalledWith({ group: "g1" });
  expect(first.heal.apply.run).not.toHaveBeenCalled();
  cleanup();
  // A held preview wears the armed word and opens on a press, with its items and the commit.
  const armed = mount({ healHeld: true });
  fireEvent.click(screen.getByText("Heal SA 1: 2 caps"));
  const open = armed.container.querySelector('[data-inbox-detail="heal:g1"]') as HTMLElement;
  await act(async () =>
    fireEvent.click(within(open).getByRole("button", { name: "heal · previewed 2" })),
  );
  expect(screen.getByText("2 pass · 0 refused")).toBeTruthy();
  expect(screen.getByText("cap 10 (end 1)")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "apply heal" })));
  expect(armed.heal.apply.run).toHaveBeenCalledWith({ group: "g1" });
});

test("a no-fan row previews making its one unit the fan, then commits from the popover", async () => {
  const first = mount();
  fireEvent.click(screen.getByText("No duct path to a fan"));
  const detail = first.container.querySelector('[data-inbox-detail="f1"]') as HTMLElement;
  await act(async () =>
    fireEvent.click(
      within(detail).getByRole("button", { name: "preview: make FC-17 the fan of SA 19" }),
    ),
  );
  expect(first.fan.preview.run).toHaveBeenCalledWith({ unitId: 17, systemId: 19 });
  expect(first.fan.apply.run).not.toHaveBeenCalled();
  cleanup();
  const armed = mount({ fanHeld: true });
  fireEvent.click(screen.getByText("No duct path to a fan"));
  const open = armed.container.querySelector('[data-inbox-detail="f1"]') as HTMLElement;
  await act(async () =>
    fireEvent.click(
      within(open).getByRole("button", { name: "make FC-17 the fan of SA 19 · previewed" }),
    ),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "make FC-17 the fan of SA 19" })),
  );
  expect(armed.fan.apply.run).toHaveBeenCalledWith({ unitId: 17, systemId: 19 });
});

test("the Write row is one preview button; its popover lists the changes and writes", async () => {
  const idle = mount();
  const idleGroup = idle.container.querySelector('[aria-label="Write"]') as HTMLElement;
  // Nothing held: the single idle button is the handle's own word, and the commit is not drawn.
  expect(within(idleGroup).queryByRole("button", { name: "write 3 to Revit" })).toBeNull();
  expect(within(idleGroup).getByRole("button", { name: "preview" })).toBeTruthy();
  cleanup();
  // Fix and Set rows standing hold back only the ESP: apply stays armed and the row says what waits.
  const held = "1 staged ESP left out of this write: 1 to fix before the ESP writes";
  const armed = mount({ held, previewed: true });
  const group = armed.container.querySelector('[aria-label="Write"]') as HTMLElement;
  fireEvent.click(screen.getByText("Write to Revit"));
  await act(async () =>
    fireEvent.click(within(group).getByRole("button", { name: "previewed 3" })),
  );
  expect(screen.getByText("3 planned · 1 refused")).toBeTruthy();
  expect(screen.getByText("FC-17 · ESP: 0.5 → 0.9")).toBeTruthy();
  expect(screen.getByText("refused: Revit says no")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "write 3 to Revit" })));
  expect(armed.apply.run).toHaveBeenCalledTimes(1);
  expect(armed.container.querySelector("[data-inbox-write-held]")?.textContent).toBe(held);
  cleanup();
  // The commit wears the handle's refusal.
  const refusedMount = mount({ apply: "Preview first", previewed: true });
  const refusedGroup = refusedMount.container.querySelector('[aria-label="Write"]') as HTMLElement;
  await act(async () =>
    fireEvent.click(within(refusedGroup).getByRole("button", { name: "previewed 3" })),
  );
  const refused = screen.getByRole("button", { name: "write 3 to Revit" });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(refused);
  expect(refusedMount.apply.run).not.toHaveBeenCalled();
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

test("picking another ruling for the selected element retains that row's details", () => {
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
    "true",
  );
});

test("Rulings use explicit pills and stage marks without replacing an excluding address", async () => {
  const onChange = vi.fn();
  const { container } = mount({
    focused: "rules:one",
    check: [
      item({ key: "rules:one", group: "check", kind: "proposal", title: "Proposed elbow rule" }),
    ],
    address: { search: search("", { kind: "heal" }), sort: "name", onChange },
  });
  expect(screen.queryByText("Proposed elbow rule")).toBeNull();
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(onChange).toHaveBeenCalledWith(search(), "name");
  cleanup();
  const staged = mount({
    check: [
      item({ key: "rules:one", group: "check", kind: "proposal", title: "Proposed elbow rule" }),
    ],
  });
  expect(staged.container.querySelector('[data-key="rules:one"]')?.getAttribute("data-stage")).toBe(
    "proposed",
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
  expect(within(help).getByText("Facing open ends need inspection in Revit.")).toBeTruthy();
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
        path: ["ruleAssignments", family, "staged"],
        value: { value: { rule: "elbow-1d-le10" } },
      }),
    ]),
  );
});

test("taking back a family assignment clears only its staged rung", async () => {
  const family = "Radius Elbow";
  const proposal = { value: { rule: "elbow-mitered-vaned" }, note: "check the vanes" };
  const doc = ductsDocumentSchema.parse({
    ruleAssignments: {
      [family]: { proposal, staged: { value: { rule: "elbow-mitered" } } },
    },
  });
  const view = mount({
    doc,
    focused: "family",
    check: [item({ key: "family", group: "check", verbs: [{ kind: "price-as", family }] })],
  });
  await act(async () =>
    fireEvent.change(screen.getByRole("combobox", { name: `price ${family} as` }), {
      target: { value: "" },
    }),
  );
  expect(view.write).toHaveBeenCalledWith([
    { path: ["ruleAssignments", family, "staged"], value: null },
  ]);
  expect(doc.ruleAssignments[family]?.proposal).toEqual(proposal);
});

test("blocking input rows carry damage while diagnostic rows stay calm", () => {
  mount({ focused: "d1" });
  expect(document.querySelector('[data-key="flows:30"]')?.getAttribute("data-damage")).toBe(
    "no flow",
  );
  expect(document.querySelector('[data-key="d1"]')?.hasAttribute("data-damage")).toBe(false);
});
