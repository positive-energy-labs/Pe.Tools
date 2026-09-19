// @vitest-environment jsdom
/**
 * The data-tables draft grid is the one `Table`: cells are the table's editable cell (commit on
 * Enter or blur, an emptied cell stores null), headings are inputs, and the column and row verbs
 * still edit the draft.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { DraftEditor } from "#/data-tables/draft-editor";
import type { Draft } from "#/routes/data-tables";

afterEach(cleanup);

const initial: Draft = {
  name: "Sizes",
  isNew: false,
  columns: [{ heading: "Size", kind: "Text" }],
  rows: [{ key: "row-a", values: ["S"] }],
};

test("the draft grid is the one Table: cells commit, headings edit, columns and rows add and drop", () => {
  let last = initial;
  function Host() {
    const [draft, setDraft] = useState<Draft | null>(initial);
    last = draft ?? initial;
    return draft ? <DraftEditor draft={draft} setDraft={setDraft} /> : null;
  }
  render(<Host />);
  const grid = screen.getByRole("grid", { name: "Sizes" });

  const cell = within(grid).getByDisplayValue("S");
  fireEvent.change(cell, { target: { value: "M" } });
  expect(last.rows[0]!.values).toEqual(["S"]); // typing stays in the cell until it commits
  fireEvent.blur(cell);
  expect(last.rows[0]!.values).toEqual(["M"]);
  const again = within(grid).getByDisplayValue("M");
  fireEvent.change(again, { target: { value: "" } });
  fireEvent.blur(again);
  expect(last.rows[0]!.values).toEqual([null]);

  fireEvent.change(within(grid).getByDisplayValue("Size"), { target: { value: "Fit" } });
  expect(last.columns[0]!.heading).toBe("Fit");

  fireEvent.click(screen.getByRole("button", { name: /^col(?!umn)/ }));
  expect(last.columns.map((column) => column.heading)).toEqual(["Fit", "Column 2"]);
  fireEvent.click(screen.getByRole("button", { name: /add row/ }));
  expect(last.rows).toHaveLength(2);

  fireEvent.click(
    within(screen.getByRole("grid"))
      .getAllByTitle(/Remove this row/)
      .at(-1)!,
  );
  expect(last.rows.map((row) => row.key)).toEqual(["row-a"]);
});
