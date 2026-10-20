// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { List } from "@pe/kit/lang/list-popup";
import { SearchControl } from "@pe/kit/lang/search-control";

afterEach(cleanup);

test("a search control is framed unless placed as a bar", () => {
  render(
    <SearchControl>
      <input aria-label="query" />
    </SearchControl>,
  );
  const frame = screen.getByLabelText("query").closest("[data-search-control]")!;
  expect(frame.getAttribute("data-face")).toBe("framed");
  expect(frame.classList.contains("dl-control")).toBe(true);
});

test("a searchable List heads itself with the bar face, crumbs and bar on the rows' inset", () => {
  render(
    <List
      aria-label="items"
      levels={[
        { label: "category", items: () => ["Ducts"] },
        { label: "type", items: () => ["Round"] },
      ]}
      keyOf={(s) => s}
      labelOf={(s) => s}
      empty="empty"
      filter="fuzzy"
      row={(item) => ({ label: item })}
    />,
  );
  const bar = screen.getByLabelText("items search").closest("[data-search-control]")!;
  expect(bar.getAttribute("data-face")).toBe("bar");
  expect(bar.classList.contains("dl-control")).toBe(false);
  expect(bar.classList.contains("m-1")).toBe(false);
  const crumbs = document.querySelector("[data-list] > .hairline-b");
  expect(crumbs?.className).toContain("px-(--item-mark-pad-x)");
  // One left text edge: the bar's field and the row both inset by --item-mark-pad-x.
  const css = readFileSync(`${import.meta.dirname}/../src/components/lang/lang.css`, "utf8");
  expect(css).toMatch(
    /\.dl-search\[data-face="bar"\] \[data-search-field\] \{\s*padding-inline: var\(--item-mark-pad-x\);/,
  );
  expect(css).toMatch(/\.dl-row \{[^}]*padding: 0 var\(--item-mark-pad-x\);/);
});
