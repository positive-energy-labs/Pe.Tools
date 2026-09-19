// @vitest-environment jsdom
/** The Chat head summary's deterministic owed tests (journeys chat-summary spec §9). */
import { familyCellKey, type TrichotomyCellLike } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { MATRIX_CELLS } from "#/design-system/band-matrix";
import { matrixHeadWork, matrixWire } from "#/design-system/band-specimen";
import { focusedTypes } from "#/families/staged";

import { COMMIT_REASON, ProposalHead, type HeadWork } from "./proposal-head";

afterEach(cleanup);

const open = (value: string): TrichotomyCellLike => ({ proposal: { value }, staged: null });
const staged = (value: string): TrichotomyCellLike => ({ proposal: null, staged: { value } });
const contested = (pea: string, you: string): TrichotomyCellLike => ({
  proposal: { value: pea },
  staged: { value: you },
});

const work = (cells: Record<string, TrichotomyCellLike>, over: Partial<HeadWork> = {}) =>
  ({
    id: "families",
    route: "Families",
    subject: "MEP.rvt",
    cells,
    wire: { segment: "cells", write: vi.fn(async () => null), revision: 12 },
    groupOf: (key: string) => key.split("/"),
    commit: { word: "plan", run: vi.fn() },
    open: vi.fn(),
    ...over,
  }) satisfies HeadWork;

const review = () => fireEvent.click(screen.getByRole("button", { name: /review/ }));
const rows = () =>
  [...document.querySelectorAll("[data-group]")].map((row) => row.getAttribute("data-group"));
const row = (label: string) =>
  within(document.querySelector(`[data-group="${label}"]`) as HTMLElement);

test("1 · no live ask and no pending Work draws nothing at all", () => {
  const view = render(<ProposalHead asks={[]} works={[work({ "a/1": {} })]} />);
  expect(view.container.innerHTML).toBe("");
});

test("2 · zero counts are omitted from the rest line; stale only when stale", () => {
  const cells = { "a/1": open("x"), "a/2": open("y") };
  const view = render(<ProposalHead asks={[]} works={[work(cells)]} />);
  const line = view.container.textContent!;
  expect(line).toContain("2 proposed");
  expect(line).not.toMatch(/staged|contested|stale|\b0 /);
  cleanup();
  render(<ProposalHead asks={[]} works={[work(cells, { stale: true })]} />);
  expect(document.body.textContent).toContain("r12 · stale");
});

test("3 · four Works draw three lines and one summed +1 more line", () => {
  const works = ["w1", "w2", "w3", "w4"].map((id, i) =>
    work({ [`a/${i}`]: open("x"), [`b/${i}`]: staged("y") }, { id }),
  );
  render(<ProposalHead asks={[]} works={works} />);
  expect(document.querySelectorAll("[data-work]")).toHaveLength(3);
  expect(screen.getByRole("button", { name: /more route/ }).textContent).toBe(
    "+1 more route with changes · 1 proposed · 1 staged",
  );
});

test("4 · seven groups draw five rows, contested first then by size, and a more link", () => {
  const cells: Record<string, TrichotomyCellLike> = { "Tiny/1": contested("a", "b") };
  const sizes = { Big: 5, Mid: 4, Small: 3, Two: 2, One: 1, Zero: 1 };
  for (const [label, n] of Object.entries(sizes))
    for (let i = 0; i < n; i += 1) cells[`${label}/${i}`] = open("v");
  const w = work(cells);
  render(<ProposalHead asks={[]} works={[w]} />);
  review();
  expect(rows()).toEqual(["Tiny", "Big", "Mid", "Small", "Two"]);
  fireEvent.click(screen.getByRole("button", { name: "… 2 more groups · open in Families ›" }));
  expect(w.open).toHaveBeenCalledWith();
});

test("5 · a uniform group shows from → to only over a uniform baseline; delete says delete", () => {
  const baselines: Record<string, string> = {
    "W/1": "8in",
    "W/2": "8in",
    "D/1": "9in",
    "D/2": "7in",
  };
  const cells = {
    "W/1": open("10in"),
    "W/2": open("10in"),
    "D/1": open("10in"),
    "D/2": open("10in"),
    "X/1": { proposal: { delete: true as const }, staged: null },
  };
  const w = work(cells);
  w.wire = { ...w.wire, baselineOf: (key) => baselines[key] };
  render(<ProposalHead asks={[]} works={[w]} />);
  review();
  expect(row("W").getByText("8in → 10in")).toBeTruthy();
  expect(row("D").getByText("→ 10in")).toBeTruthy();
  expect(row("X").getByText("→ delete")).toBeTruthy();
});

test("6 · a diverse group shows its count and two examples through the route formatter", () => {
  const cells = { "A/1": open("a"), "A/2": open("b"), "A/3": open("c"), "A/4": open("d") };
  render(<ProposalHead asks={[]} works={[work(cells, { show: (v) => `${String(v)}!` })]} />);
  review();
  expect(row("A").getByText("4 values (e.g. a!, b!)")).toBeTruthy();
});

test("6b · F-J1-3: values that read the same across families are one value, not one per family", () => {
  const cells: Record<string, TrichotomyCellLike> = {};
  const say = (value: string, familyName: string) => ({
    proposal: { value: { familyName, value } },
  });
  for (let i = 0; i < 89; i += 1) cells[`View Description/${i}`] = say("J1 hold2", `F${i % 3}`);
  for (let i = 0; i < 4; i += 1) cells[`Mark/${i}`] = say(i % 2 ? "J1" : "J2", `F${i}`);
  const show = (v: unknown) => (v as { value: string }).value;
  render(<ProposalHead asks={[]} works={[work(cells, { show })]} />);
  review();
  expect(row("View Description").getByText("→ J1 hold2")).toBeTruthy();
  expect(row("View Description").getByText("89 cells")).toBeTruthy();
  expect(row("Mark").getByText("2 values (e.g. J2, J1)")).toBeTruthy();
});

test("7 · accept k skips contested and locked keys, says why, and a foreign write refuses", async () => {
  const cells = {
    "A/1": open("x"),
    "A/2": open("x"),
    "A/3": open("x"),
    "A/4": contested("x", "you"),
    "A/5": open("x"),
  };
  const w = work(cells);
  w.wire = { ...w.wire, lockOf: (key) => (key === "A/5" ? "formula" : null) };
  render(<ProposalHead asks={[]} works={[w]} />);
  review();
  await act(async () => fireEvent.click(row("A").getByRole("button", { name: "accept 3" })));
  expect(w.wire.write).toHaveBeenCalledOnce();
  expect(vi.mocked(w.wire.write).mock.calls[0]![1]).toBe(12);
  expect(row("A").getByText("accepted 3 · skipped 2 (contested: 1, locked: 1)")).toBeTruthy();

  cleanup();
  const moved = work(cells, {
    wire: {
      segment: "cells",
      revision: 12,
      // Another writer landed r13 between render and press: the bound write refuses.
      write: vi.fn(async (_patches, expected) =>
        expected === 13 ? null : { code: "stale-revision", message: "changed since you looked" },
      ),
    },
  });
  render(<ProposalHead asks={[]} works={[moved]} />);
  review();
  await act(async () => fireEvent.click(row("A").getByRole("button", { name: /deny/ })));
  expect(row("A").getByText("changed since you looked")).toBeTruthy();
  expect(row("A").getByText("nothing was written")).toBeTruthy();
});

test("8 · a staged-only group has no group verbs", () => {
  render(<ProposalHead asks={[]} works={[work({ "S/1": staged("a"), "S/2": staged("b") })]} />);
  review();
  expect(row("S").getByText("2 staged")).toBeTruthy();
  expect(row("S").queryByRole("button", { name: /accept|deny/ })).toBeNull();
});

test("9 · a group's › opens the route scoped to its path; the pane narrows to it", () => {
  const w = work({ "Neck Width/1": open("10in") });
  render(<ProposalHead asks={[]} works={[w]} />);
  review();
  fireEvent.click(screen.getByRole("button", { name: "open Neck Width in Families" }));
  expect(w.open).toHaveBeenCalledWith(["Neck Width"]);
  const key = (familyName: string, typeName: string, parameter: string) =>
    familyCellKey({ familyName, typeName, parameter });
  const familyCells = {
    [key("F", "A", "Neck Width")]: { proposal: { value: { value: "10in" } } },
    [key("G", "B", "Throw")]: { proposal: { value: { value: "12ft" } } },
    [key("H", "C", "Neck Width")]: {},
  };
  expect(focusedTypes(familyCells as never, ["Neck Width"])).toEqual([
    { familyName: "F", typeName: "A", parameter: "Neck Width" },
  ]);
});

test("11 · the commit verb is refused with nothing staged, and otherwise only hands off", () => {
  render(<ProposalHead asks={[]} works={[work({ "a/1": open("x") })]} />);
  const refused = screen.getByRole("button", { name: "plan r12" });
  expect(refused.hasAttribute("disabled")).toBe(true);
  expect(refused.getAttribute("title")).toBe("nothing staged");
  cleanup();
  const w = work({ "a/1": staged("x") });
  render(<ProposalHead asks={[]} works={[w]} />);
  const plan = screen.getByRole("button", { name: "plan r12" });
  expect(plan.getAttribute("title")).toBe(COMMIT_REASON);
  expect(COMMIT_REASON).toContain("staging is not applying");
  fireEvent.click(plan);
  expect(w.commit.run).toHaveBeenCalledOnce();
  // The head never draws a confirmation sheet: nothing to apply here.
  expect(screen.queryByRole("button", { name: /apply/ })).toBeNull();
});

test("the head never lists cells: 144 addresses read as one line and at most five groups", () => {
  const say = vi.fn();
  const matrix = { cells: MATRIX_CELLS, wire: matrixWire(async () => null), outcome: null };
  render(<ProposalHead asks={[]} works={[matrixHeadWork(matrix, say)]} />);
  review();
  expect(rows().length).toBeLessThanOrEqual(5);
  // No type (row) name appears: every line is a count, a digest or a group label.
  for (const type of ["FCU-1", "HP-2", "AHU-1", "UH-3"])
    expect(document.body.textContent).not.toContain(type);
});

test("an ask line sits above the Work lines and is not a cell", () => {
  render(
    <ProposalHead
      asks={[<div key="ask">⌗ family.capture</div>]}
      works={[work({ "a/1": open("x") })]}
    />,
  );
  const region = screen.getByLabelText("Pea proposals");
  expect(region.firstElementChild?.textContent).toBe("⌗ family.capture");
});

test("F-J1-8: a group's unstage all clears its N staged cells in one write, asking first", async () => {
  const cells = {
    "A/1": staged("1"),
    "A/2": staged("2"),
    "A/3": contested("pea", "you"),
    "A/4": open("pea-only"),
  };
  const w = work(cells);
  render(<ProposalHead asks={[]} works={[w]} />);
  review();
  const unstage = () => row("A").getByRole("button", { name: /unstage/ });
  expect(unstage().textContent).toContain("unstage all (3)");
  // The first press only asks.
  await act(async () => fireEvent.click(unstage()));
  expect(unstage().textContent).toContain("unstage 3 staged? press again");
  expect(w.wire.write).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(unstage()));
  expect(w.wire.write).toHaveBeenCalledOnce();
  const patches = vi.mocked(w.wire.write).mock.calls[0]![0] as { path: string[] }[];
  // Only staged rungs are written; no proposal is touched.
  expect(patches.every((patch) => patch.path[2] === "staged")).toBe(true);
  expect(patches.map((patch) => patch.path[1]).sort()).toEqual(["A/1", "A/2", "A/3"]);
});
