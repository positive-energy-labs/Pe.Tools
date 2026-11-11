import { describe, expect, test } from "vite-plus/test";
import { link, type CatalogLink } from "./catalog.ts";
const errorsOf = (entries: readonly CatalogLink[]) => {
  const result = link(entries);
  return result.ok ? [] : [...result.errors];
};
import { httpRoutes, linkedCatalog, peRoutes } from "./pe-api.ts";
const catalogEntries = [...linkedCatalog().entries.values()];
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
    expect(errorsOf([{ ...leaf("all"), cardinality: "Many" }]).join()).toContain(
      "requires a cap",
    );
  });
  test("rejects missing keys and cycles", () => {
    expect(errorsOf([leaf("a", ["missing"])]).join()).toContain("unknown dependency");
    expect(errorsOf([leaf("a", ["b"]), leaf("b", ["a"])]).join()).toContain("cycle");
  });
  test("refuses an HTTP route priced below its native child", () => {
    const child = { ...leaf("native.walk"), cost: "Expensive" as const };
    const route = { ...leaf("route:sheet", [child.key]), cost: "Cheap" as const };
    expect(errorsOf([route, child])).toEqual(["route:sheet: cost understates native.walk"]);
    expect(errorsOf([{ ...route, cost: "Expensive" }, child])).toEqual([]);
  });
  test("charges repeated child calls, including uncapped calls", () => {
    const child = leaf("walk");
    const parent = leaf("all", [{ key: "walk", cardinality: "Many", cap: 99 }]);
    expect(errorsOf([parent, child]).join()).toContain("understates");
    expect(errorsOf([{ ...parent, cardinality: "Many", cap: 99 }, child])).toEqual([]);
    expect(
      errorsOf([{ ...parent, uses: [{ key: "walk", cardinality: "Many" }] }, child]).join(),
    ).toContain("understates");
  });
  test("binds every ModelWrite's seal step to a plan (Read or rolled-back TransactRead) of the same footprint", () => {
    const derivation = { derive: (work: unknown) => work, preview: (request: unknown) => request };
    const write = { ...leaf("command:x.apply"), ...derivation, effect: "ModelWrite" as const, previewBy: "command:x.preview" };
    const preview = { ...leaf("command:x.preview"), effect: "TransactRead" as const, rollsBack: true };
    expect(errorsOf([write, preview])).toEqual([]);
    // ADR 0030 rule 4: a plan that opens no transaction is a Read and links.
    expect(errorsOf([write, { ...preview, effect: "Read", rollsBack: undefined }])).toEqual([]);
    // A plan that may write is refused, whatever it is called.
    expect(errorsOf([write, { ...preview, effect: "ModelWrite" }])).toContain(
      "command:x.apply: plan command:x.preview is ModelWrite, not Read or TransactRead",
    );
    expect(errorsOf([write, { ...preview, effect: "SessionWrite" }]).join()).toContain("not Read or TransactRead");
    expect(errorsOf([write, { ...preview, rollsBack: false }])).toContain(
      "command:x.preview: TransactRead must declare rollback",
    );
    expect(errorsOf([write, { ...preview, touches: ["Metadata"] }])).toContain(
      "command:x.apply: preview command:x.preview touches differ",
    );
    expect(errorsOf([write])).toContain("command:x.apply: unknown preview command:x.preview");
    expect(errorsOf([{ ...write, previewBy: undefined }])).toContain(
      "command:x.apply: ModelWrite has no preview binding",
    );
  });
  test("the shipped write leaves split preview from commit", () => {
    const byKey = new Map(catalogEntries.map((row) => [row.key, row]));
    // ducts.apply plans with no transaction (a Read); the others rehearse and roll back.
    expect(byKey.get("ducts.apply")).toMatchObject({ effect: "ModelWrite", internal: true, previewBy: "ducts.apply.plan" });
    expect(byKey.get("ducts.apply.plan")).toMatchObject({ effect: "Read", rollsBack: false });
    expect(byKey.get("ducts.apply.preview")).toBeUndefined();
    // Every Ducts plan is a Read and is the apply's only seal authority; a rehearsal rolls back and arms nothing.
    // The losses pair is the sheet pair (slice 7): one plan/apply every sheet shares.
    expect(byKey.get("command:sheet.plan")).toMatchObject({ effect: "Read" });
    expect(byKey.get("command:sheet.apply")).toMatchObject({ effect: "ModelWrite", previewBy: "command:sheet.plan" });
    for (const kind of ["heal", "assign-fan"]) {
      expect(byKey.get(`command:ducts.plan-${kind}`)).toMatchObject({ effect: "Read" });
      expect(byKey.get(`command:ducts.apply-${kind}`)).toMatchObject({ effect: "ModelWrite", previewBy: `command:ducts.plan-${kind}` });
      expect(byKey.get(`command:ducts.preview-${kind}`)).toBeUndefined();
    }
    for (const kind of ["heal", "assign-fan"])
      expect(byKey.get(`command:ducts.rehearse-${kind}`)).toMatchObject({ effect: "TransactRead", rollsBack: true });
    for (const key of ["ducts.heal", "ducts.assign-fan", "revit.apply.parameter-links"]) {
      expect(byKey.get(key)).toMatchObject({ effect: "ModelWrite", internal: true, previewBy: `${key}.preview` });
      expect(byKey.get(`${key}.preview`)).toMatchObject({ effect: "TransactRead", rollsBack: true });
    }
    for (const row of catalogEntries.filter((row) => row.key.startsWith("command:") && row.effect === "ModelWrite"))
      expect(["Read", "TransactRead"]).toContain(byKey.get(row.previewBy!)?.effect);
  });
});
