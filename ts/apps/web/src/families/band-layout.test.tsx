// @vitest-environment jsdom
/**
 * F-R4-1: staging never moves the grid under the person. Layout in jsdom is weak, so this holds
 * the structural property: everything above the grid that staging changes lives in a region whose
 * block size is fixed and which scrolls itself, and the chip row holds its line before any chip.
 * Real-browser check (next hold): stage 1 then 5 cells, the first grid row's offsetTop is unchanged.
 */
import { familyCellKey, type FamilyCellState } from "@pe/agent-contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { emptyTableState } from "#/components/master-table/view";
import { FamiliesProposalsBand } from "./readout-bands";
import { FamiliesWorkspaceProvider } from "./workspace-context";

afterEach(cleanup);

const staged = (n: number): Record<string, FamilyCellState> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      familyCellKey({ familyName: `F${i}`, typeName: "T", parameter: "Model" }),
      { proposal: null, staged: { value: { value: `v${i}` } } },
    ]),
  );

const band = (cells: Record<string, FamilyCellState>) => (
  <FamiliesWorkspaceProvider
    value={
      {
        cells,
        rows: [],
        params: [],
        wire: { segment: "cells", revision: 1, write: async () => null },
      } as never
    }
  >
    <FamiliesProposalsBand />
  </FamiliesWorkspaceProvider>
);

test("the proposals band keeps one shape from 0 to 1 to 5 staged cells: a fixed, self-scrolling region", () => {
  const shapes = [0, 1, 5].map((n) => {
    const { container, unmount } = render(band(staged(n)));
    const section = container.querySelector("section[aria-label='proposals']");
    const region = container.querySelector<HTMLElement>("[data-slot='proposals-list']");
    const shape = {
      section: section != null,
      region: region?.className ?? null,
      rows: region?.querySelectorAll("[data-proposal-row]").length ?? 0,
    };
    unmount();
    return shape;
  });
  // Present before anything is staged, so the first stage adds no block.
  expect(shapes.every((s) => s.section)).toBe(true);
  // The list's block size is fixed (h-*, never max-h), and it scrolls itself.
  for (const s of shapes) {
    expect(s.region).toMatch(/(^|\s)h-\S+/);
    expect(s.region).not.toMatch(/max-h-/);
    expect(s.region).toMatch(/overflow-y-auto/);
  }
  expect(shapes.map((s) => s.region)).toEqual(Array(3).fill(shapes[0]!.region));
  expect(shapes.map((s) => s.rows)).toEqual([0, 1, 5]);
});

test("a frame with route-owned chips reserves the chip row's line before the first chip", () => {
  const { container } = render(
    <TableFrame
      label="families"
      rows={[]}
      columns={[]}
      rowKey={() => ""}
      state={emptyTableState()}
      onStateChange={() => {}}
      chips={[]}
    >
      <Table rows={[]} columns={[]} rowKey={() => ""} label="families" />
    </TableFrame>,
  );
  const strip = container.querySelector<HTMLElement>("[data-slot='table-filters']");
  expect(strip).not.toBe(null);
  expect(strip!.className).toMatch(/min-h-\(--item-h\)/);
});
