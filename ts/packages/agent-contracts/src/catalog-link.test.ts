import { describe, expect, it } from "vite-plus/test";
import { commandLink, link, type CatalogLink } from "./catalog.ts";
import { commandCatalogAxes } from "./command-axes.ts";
import { linkedCatalog } from "./pe-api.ts";
const catalogEntries = [...linkedCatalog().entries.values()];

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

describe("commandLink and declared plan axes", () => {
  it("keeps a Pod command's native uses, so its cost is checked against the native leaf", () => {
    const pod = commandLink(
      "pod.acme.write",
      { says: "x", dirties: [], needs: "project-document", effect: "command", input: {} as never, native: ["ducts.apply"] },
      { subject: "Document", touches: ["Geometry"], effect: "ModelWrite", cost: "Cheap", cardinality: "One" },
      "",
    );
    expect(pod).toMatchObject({ key: "pod.acme.write", uses: ["ducts.apply"] });
    const extended = linkedCatalog().extend([pod]);
    expect(extended.ok ? [] : extended.errors).toContain("pod.acme.write: cost understates ducts.apply");
  });

  it("declares catalog Work plans Read, and never reads a no-native rehearsal as Read", () => {
    expect(commandCatalogAxes["data-table.apply.plan"]).toMatchObject({ effect: "Read" });
    expect(commandCatalogAxes["parameter-links.apply.plan"]).toMatchObject({ effect: "Read" });
    expect(commandCatalogAxes["data-table.apply"]).toMatchObject({ effect: "ModelWrite" });
    expect(commandCatalogAxes["families.apply.preview"]).toMatchObject({ effect: "TransactRead", rollsBack: true });
  });
});
