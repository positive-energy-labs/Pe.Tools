import { describe, expect, test } from "vite-plus/test";
import { linkCatalog, type CatalogLink } from "./catalog.ts";
import { catalogEntries, httpRoutes, peRoutes } from "./pe-api.ts";
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
  test("declares every HTTP route and includes its children's touched data", () => {
    const byKey = new Map(catalogEntries.map((row) => [row.key, row]));
    for (const id of Object.keys(httpRoutes) as (keyof typeof httpRoutes)[]) {
      const route = peRoutes[id].catalog;
      expect(route.key).toBe(`route:${id}`);
      for (const use of route.uses) {
        const child = byKey.get(typeof use === "string" ? use : use.key)!;
        expect(child).toBeDefined();
        expect(route.touches).toEqual(expect.arrayContaining([...child.touches]));
      }
    }
    for (const id of ["thread.export", "turn.element-names", "ducts.analysis"] as const)
      expect(peRoutes[id].catalog.effect).toBe("SessionWrite");
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
  test("refuses an HTTP route priced below its native child", () => {
    const child = { ...leaf("native.walk"), cost: "Expensive" as const };
    const route = { ...leaf("route:sheet", [child.key]), cost: "Cheap" as const };
    expect(linkCatalog([route, child])).toEqual(["route:sheet: cost understates native.walk"]);
    expect(linkCatalog([{ ...route, cost: "Expensive" }, child])).toEqual([]);
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
