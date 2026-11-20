// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { homeFile, landings, productWrites } from "@pe/agent-contracts/product";
import { afterEach, expect, test } from "vite-plus/test";
import { TutorialHomes } from "./tutorial-homes";
import { tutorialProducts } from "./tutorial-products.generated";

afterEach(cleanup);

function homeRow(name: string) {
  const table = screen.getByRole("grid", { name: "Homes" });
  const rows = within(table).getAllByText(name, {
    exact: true,
    selector: '[data-column-key="home"] > div',
  });
  const row = rows[0]?.closest("tr");
  if (!row) throw Error(`No row for home ${name}`);
  return row;
}

test.each(tutorialProducts)(
  "$id Tutorial renders declared homes, landings and writers",
  (product) => {
    render(<TutorialHomes product={product} />);
    const lands = landings(product);
    for (const [name, home] of Object.entries(product.homes)) {
      const row = homeRow(name);
      for (const text of [home.key, home.kind, ...Object.values(home.cost)]) {
        expect(row.textContent).toContain(text);
      }
      expect(within(row).getByText(home.rung ?? "Outside ladder")).toBeTruthy();
      for (const [key, writes] of Object.entries(productWrites(product))) {
        const writers = row.querySelector('[data-column-key="commands"]')?.textContent?.split(", ");
        expect(writers?.includes(key)).toBe(Object.hasOwn(writes, name));
      }
    }
    for (const cell of Object.keys(product.cells)) {
      const home = Object.hasOwn(lands, cell) ? lands[cell] : "Work";
      expect(
        homeRow(home).querySelector('[data-column-key="cells"]')?.textContent?.split(", "),
      ).toContain(cell);
    }
  },
);

test("adding a home to a declaration adds its Tutorial row", () => {
  const [product] = tutorialProducts;
  if (!product) throw Error("No assembled product");
  const example = homeFile("example");
  render(<TutorialHomes product={{ ...product, homes: { ...product.homes, example } }} />);
  expect(homeRow("example").textContent).toContain(example.key);
});
