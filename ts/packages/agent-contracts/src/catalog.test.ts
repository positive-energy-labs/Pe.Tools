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
  test("binds every ModelWrite's seal step to a rolled-back read of the same footprint", () => {
    const derivation = { derive: (work: unknown) => work, preview: (request: unknown) => request };
    const write = { ...leaf("command:x.apply"), ...derivation, effect: "ModelWrite" as const, previewBy: "command:x.preview" };
    const preview = { ...leaf("command:x.preview"), effect: "TransactRead" as const, rollsBack: true };
    expect(linkCatalog([write, preview])).toEqual([]);
    // A preview that may commit is refused, whatever it is called.
    expect(linkCatalog([write, { ...preview, effect: "ModelWrite" }])).toContain(
      "command:x.apply: preview command:x.preview is ModelWrite, not TransactRead",
    );
    expect(linkCatalog([write, { ...preview, effect: "Read" }]).join()).toContain("not TransactRead");
    expect(linkCatalog([write, { ...preview, rollsBack: false }])).toContain(
      "command:x.preview: TransactRead must declare rollback",
    );
    expect(linkCatalog([write, { ...preview, touches: ["Metadata"] }])).toContain(
      "command:x.apply: preview command:x.preview touches differ",
    );
    expect(linkCatalog([write])).toContain("command:x.apply: unknown preview command:x.preview");
    expect(linkCatalog([{ ...write, previewBy: undefined }])).toContain(
      "command:x.apply: ModelWrite has no preview binding",
    );
  });
  test("the shipped write leaves split preview from commit", () => {
    const byKey = new Map(catalogEntries.map((row) => [row.key, row]));
    for (const key of ["ducts.apply", "ducts.heal", "ducts.assign-fan", "revit.apply.parameter-links"]) {
      expect(byKey.get(key)).toMatchObject({ effect: "ModelWrite", internal: true, previewBy: `${key}.preview` });
      expect(byKey.get(`${key}.preview`)).toMatchObject({ effect: "TransactRead", rollsBack: true });
    }
    for (const row of catalogEntries.filter((row) => row.key.startsWith("command:") && row.effect === "ModelWrite"))
      expect(byKey.get(row.previewBy!)?.effect).toBe("TransactRead");
  });
});
