import { describe, expect, test } from "vite-plus/test";
import { linkCatalog, type CatalogLink } from "./catalog.ts";
import { catalogEntries } from "./pe-api.ts";
const leaf = (key: string, uses: CatalogLink["uses"] = []): CatalogLink => ({
  key,
  uses,
  subject: "Elements",
  touches: ["Geometry"],
  effect: "Read",
  cost: "Bounded",
  cardinality: "One",
});
describe("catalog dependency graph", () => {
  test("links the shipped catalog", () => {
    expect(linkCatalog(catalogEntries)).toEqual([]);
  });
  test("refuses uncapped geometry cardinality", () => {
    expect(linkCatalog([{ ...leaf("all"), cardinality: "Many" }]).join()).toContain(
      "requires a cap",
    );
  });
  test("rejects missing keys and cycles", () => {
    expect(linkCatalog([leaf("a", ["missing"])]).join()).toContain("unknown dependency");
    expect(linkCatalog([leaf("a", ["b"]), leaf("b", ["a"])]).join()).toContain("cycle");
  });
  test("charges repeated child calls, including uncapped calls", () => {
    const child = leaf("walk");
    const parent = leaf("all", [{ key: "walk", cardinality: "Many", cap: 99 }]);
    expect(linkCatalog([parent, child]).join()).toContain("understates");
    expect(linkCatalog([{ ...parent, cardinality: "Many", cap: 99 }, child])).toEqual([]);
    expect(
      linkCatalog([{ ...parent, uses: [{ key: "walk", cardinality: "Many" }] }, child]).join(),
    ).toContain("understates");
  });
});
