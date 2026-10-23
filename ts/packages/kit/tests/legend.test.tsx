// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Legend, legendWord, type LegendRow, type LegendWord } from "../src/components/lang/legend";

afterEach(cleanup);

it("rejects sentences and labels longer than four words at construction and rendering", () => {
  for (const text of ["First. Second", "a b c d e", "A sentence.", "", "why? now"])
    expect(() => legendWord(text)).toThrow("Legend word");
  expect(legendWord("one two three four")).toBe("one two three four");
  const row: LegendRow = {
    key: "bad",
    stroke: { ink: "currentColor", width: 1 },
    // @ts-expect-error Unchecked strings cannot enter Legend rows.
    word: "First. Second",
  };
  expect(() => render(<Legend label="test" rows={[row]} />)).toThrow("Legend word");
  expect(() =>
    render(<Legend label="test" missing={{ ...row, word: "a b c d e" as LegendWord }} />),
  ).toThrow("Legend word");
});

it("binds mark, short word and optional count; explanations stay in kit Tooltip", () => {
  const says = "A connector has nothing attached; caps are not open ends.";
  const { container } = render(
    <Legend
      label="health"
      rows={[
        {
          key: "open",
          stroke: { ink: "currentColor", width: 2 },
          word: legendWord("open end"),
          count: 0,
          says,
        },
        {
          key: "held",
          stroke: { ink: "currentColor", width: 1, shape: "box" },
          word: legendWord("held"),
        },
      ]}
    />,
  );
  const row = container.querySelector('[data-bin="open"]')!;
  expect(row.textContent).toBe("open end0");
  expect(row.querySelector("svg line")).not.toBeNull();
  expect(row.getAttribute("aria-description")).toBe(says);
  expect(screen.queryByText(says)).toBeNull();
  expect(container.querySelector('[data-bin="held"] rect')).not.toBeNull();
});
