// @vitest-environment jsdom
/**
 * F-J1-8: bulk unstage. One control where the aggregate accept/deny live; a two-press confirm on
 * the same control (it removes the person's own work); one `fanOut` write; Pea's proposals stay.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { UnstageAll, fanOutWord, type CellWire, type FanOutOutcome } from "#/components/lang/band";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Cells = Record<string, TrichotomyCellLike>;
type Patch = { path: (string | number)[]; value?: unknown };

const INITIAL: Cells = {
  a: { staged: { value: "1" } },
  b: { staged: { value: "2" }, proposal: { value: "pea-2" } },
  c: { staged: { value: "3" } },
  d: { proposal: { value: "pea-4" } },
};

let state: { cells: Cells; writes: Patch[][]; outcome: FanOutOutcome | null };

function Harness() {
  const [cells, setCells] = useState(INITIAL);
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  const writes = useRef<Patch[][]>([]).current;
  const wire: CellWire = {
    segment: "cells",
    revision: 1,
    write: async (patches) => {
      writes.push(patches as Patch[]);
      setCells((current) => {
        const next = structuredClone(current) as Record<string, Record<string, unknown>>;
        for (const { path, value } of patches as Patch[]) {
          const [, key, rung] = path as [string, string, string];
          if (value === undefined || value === null) delete next[key]![rung];
          else next[key]![rung] = value;
        }
        return next as Cells;
      });
      return null;
    },
  };
  state = { cells, writes, outcome };
  return (
    <>
      <UnstageAll wire={wire} cells={cells} keys={Object.keys(cells)} done={setOutcome} />
      {outcome ? <span>{fanOutWord(outcome)}</span> : null}
    </>
  );
}

const control = () => screen.getByRole("button", { name: /unstage/ });

test("the first press alone changes nothing: it asks, on the same control", async () => {
  render(<Harness />);
  expect(control().textContent).toContain("unstage all (3)");
  await act(async () => fireEvent.click(control()));
  expect(control().textContent).toContain("unstage 3 staged? press again");
  expect(state.writes).toHaveLength(0);
  // Escape cancels the confirm.
  await act(async () => fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" }));
  expect(control().textContent).toContain("unstage all (3)");
  expect(state.writes).toHaveLength(0);
});

test("the confirm lapses after about 4 s without writing", async () => {
  vi.useFakeTimers();
  render(<Harness />);
  await act(async () => fireEvent.click(control()));
  await act(async () => vi.advanceTimersByTime(4100));
  expect(control().textContent).toContain("unstage all (3)");
  expect(state.writes).toHaveLength(0);
});

test("the second press unstages N staged cells in one write; Pea's proposals survive", async () => {
  render(<Harness />);
  await act(async () => fireEvent.click(control()));
  await act(async () => fireEvent.click(control()));
  expect(state.writes).toHaveLength(1);
  expect(Object.values(state.cells).every((cell) => cell.staged == null)).toBe(true);
  expect(state.cells.b?.proposal).toEqual({ value: "pea-2" });
  expect(state.cells.d?.proposal).toEqual({ value: "pea-4" });
  expect(await screen.findByText(/^unstaged 3/)).toBeTruthy();
});
