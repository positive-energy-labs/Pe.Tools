import { describe, expect, it } from "vite-plus/test";
import { link, type CatalogLink } from "./catalog.ts";
import { catalogEntries } from "./pe-api.ts";

const leaf = (key: string, uses: string[] = []): CatalogLink => ({
  key, uses, subject: "Document", touches: ["Metadata"], effect: "Read", cost: "Bounded", cardinality: "One",
});

describe("link", () => {
  it("returns the frozen export of the real catalog in dependency order", () => {
    const result = link(catalogEntries);
    if (!result.ok) throw Error(result.errors.join("\n"));
    expect(result.catalog.entries.size).toBe(catalogEntries.length);
    expect(Object.isFrozen(result.catalog.order)).toBe(true);
    for (const [key, entry] of result.catalog.entries)
      for (const use of entry.uses)
        expect(result.catalog.order.indexOf(typeof use === "string" ? use : use.key)).toBeLessThan(
          result.catalog.order.indexOf(key),
        );
  });

  it("refuses instead of exporting, and extend links new entries against the base", () => {
    expect(link([leaf("a", ["b"]), leaf("b", ["a"])])).toMatchObject({ ok: false });
    const base = link([leaf("walk")]);
    if (!base.ok) throw Error("base");
    expect(base.catalog.extend([leaf("route:x", ["walk"])])).toMatchObject({ ok: true });
    expect(base.catalog.extend([leaf("route:y", ["missing"])])).toMatchObject({ ok: false });
    expect(base.catalog.entries.has("route:x")).toBe(false);
  });
});
