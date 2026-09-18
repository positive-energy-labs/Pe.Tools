// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { GROUPS } from "./type-values";
import { VariantGridLens } from "./grid-lens";

afterEach(cleanup);

test("the grid lens is one Table per type group, sharing one sort, with linked StateCells", () => {
  render(
    <VariantGridLens
      applicable={[]}
      refusals={[]}
      linkedCellProps={() => ({ value: "110.0" })}
      factLabel={(link) => link.factKey}
    />,
  );
  const grids = screen.getAllByRole("grid");
  expect(grids.map((grid) => grid.getAttribute("aria-label"))).toEqual(GROUPS.map((g) => g.name));
  const tags = (grid: HTMLElement) =>
    within(grid)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")!.textContent);
  const first = grids.find((grid) => tags(grid).length > 1)!;
  const before = tags(first);
  // Sort by Tag, twice: descending reverses every group's rows (one view, every group).
  const sortTag = () => fireEvent.click(within(first).getByRole("button", { name: /^Tag/ }));
  sortTag();
  sortTag();
  expect(tags(first)).toEqual([...before].sort().reverse());
  // Each row draws both linked columns through the language's StateCell.
  expect(first.querySelectorAll("tbody [data-master-cell] [data-scale='row']").length).toBe(
    tags(first).length * 2,
  );
});
