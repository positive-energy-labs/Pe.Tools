import { describe, expect, it } from "vite-plus/test";
import { catalogWorks, CatalogWorkRefused, dataTableWorkSchema } from "./catalog-work.ts";
import { parameterLinksDocumentSchema } from "./parameter-links.ts";
import { bindWork, canonicalWorkKey, workKey } from "./route-state.ts";
import { address } from "./target.ts";

describe("canonicalWorkKey", () => {
  it("folds address spelling into one identity and keeps Save As from as transport", () => {
    const from = { session: "s", openId: "o" };
    const a = bindWork("ducts", address("C:/Jobs/A.rvt"), undefined, from);
    const b = bindWork("ducts", address("c:\\jobs\\a.rvt"));
    expect(workKey(a)).toBe(workKey(b));
    expect(canonicalWorkKey(a)).toEqual({ ...b, target: "c:\\jobs\\a.rvt", from });
    expect(workKey(bindWork("ducts", null, undefined, from))).not.toBe(workKey(b));
  });
});

const table = (tables: unknown) => dataTableWorkSchema.parse({ tables });
const base = {
  T: {
    columns: [
      { key: "g1", heading: "A", kind: "Text" as const },
      { key: "g2", heading: "B", kind: "Text" as const },
    ],
    rows: { r1: { g1: "a1", g2: "b1" } },
  },
};
const derive = (doc: unknown) => catalogWorks["data-table"].derive(table(doc), base);

describe("data-table derive", () => {
  it("keeps each existing column at its ordinal and fills unstaged cells from the model", () => {
    const [request] = derive({
      T: { columns: { g1: { edit: { value: { heading: "A2", kind: "Text" } } } }, rows: { r1: { g2: { edit: { value: "x" } } } } },
    });
    expect(request).toEqual({
      table: { name: "T", columns: [{ heading: "A2", kind: "Text" }, { heading: "B", kind: "Text" }], rows: [{ key: "r1", values: ["a1", "x"] }] },
    });
  });

  it("refuses a delete that would shift a later same-kind column onto another parameter", () => {
    expect(() => derive({ T: { columns: { g1: { edit: { delete: true } } } } })).toThrow(CatalogWorkRefused);
  });

  it("sends every row with the new column cleared when a column is added", () => {
    const [request] = derive({ T: { columns: { n: { edit: { value: { heading: "C", kind: "Number" } } } } } });
    expect(request).toMatchObject({ table: { rows: [{ key: "r1", values: ["a1", "b1", null] }] } });
  });

  it("refuses an authored column order", () => {
    expect(() => table({ T: { order: ["g2", "g1"] } })).toThrow();
  });
});

describe("parameter-links derive", () => {
  const definition = {
    sourceCategoryId: -2001040,
    sourceParameter: { name: "MOCP" },
    relationship: "sameElement" as const,
    targetParameter: { name: "Breaker" },
  };
  const stored = { formatVersion: 1, definitions: [{ id: "d1", ...definition }], assignments: [] };

  it("lays staged cells over the stored profile by id, and stages nothing when no cell is edited", () => {
    const doc = parameterLinksDocumentSchema.parse({
      assignments: { a1: { edit: { value: { definitionId: "d1", sourceElementUniqueIds: ["u-1"] } } } },
    });
    const [request] = catalogWorks["parameter-links"].derive(doc, stored);
    expect(request).toMatchObject({
      reconcile: true,
      profile: { definitions: [{ id: "d1" }], assignments: [{ id: "a1", definitionId: "d1", sourceElementUniqueIds: ["u-1"] }] },
    });
    expect(catalogWorks["parameter-links"].derive(parameterLinksDocumentSchema.parse({}), stored)).toEqual([]);
  });

  it("refuses the old whole-profile shape", () => {
    expect(() => parameterLinksDocumentSchema.parse({ profile: {} })).toThrow();
  });
});
