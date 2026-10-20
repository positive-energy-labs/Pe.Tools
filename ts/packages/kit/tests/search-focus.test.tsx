// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, test } from "vite-plus/test";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { SearchControl } from "@pe/kit/lang/search-control";

afterEach(cleanup);

test("a click portalled out of the search lead never focuses the search input", () => {
  render(
    <SearchControl lead={createPortal(<div role="option">row</div>, document.body)}>
      <input aria-label="query" />
    </SearchControl>,
  );
  fireEvent.click(screen.getByRole("option", { name: "row" }));
  expect(document.activeElement).not.toBe(screen.getByLabelText("query"));
  fireEvent.click(document.querySelector("[data-search-field]")!);
  expect(document.activeElement).toBe(screen.getByLabelText("query"));
});

test("a picker with a search lead opens with focus in its search input", async () => {
  render(
    <ListPopup
      anchor="trigger"
      trigger="pick"
      items={["a", "b", "c"]}
      keyOf={(s) => s}
      labelOf={(s) => s}
      aria-label="items"
      empty="empty"
      filter="fuzzy"
      row={(item) => ({ label: item })}
      searchTrail={<button type="button">negate</button>}
      onPick={() => {}}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /pick/ }));
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(screen.getByRole("button", { name: "negate" })).toBeTruthy();
  expect(document.activeElement?.tagName).toBe("INPUT");
});
