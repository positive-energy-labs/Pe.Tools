import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStatePatch, RouteStateSpec } from "./route-state.ts";
import { cellPatches, clearAll, draftCellSchema, summarize, type CellLike } from "./draft.ts";

const cellSchema = draftCellSchema(z.string());
const docSchema = z.object({ cells: z.record(z.string(), cellSchema).default({}) });
type Doc = z.infer<typeof docSchema>;
const spec = {
  route: "t",
  title: "T",
  description: "t",
  schema: docSchema,
} satisfies RouteStateSpec<typeof docSchema>;
const envelope = (cells: Record<string, CellLike>, revision = 3): RouteEnvelope<Doc> => ({
  version: 1,
  revision,
  doc: docSchema.parse({ cells }),
});
const land = (at: RouteEnvelope<Doc>, by: "pea" | "human", patches: RouteStatePatch[]) => {
  const result = applyPatches(spec, at, by, patches, at.revision);
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.envelope as RouteEnvelope<Doc>;
};
const set = (cell: CellLike, value: string) =>
  cellPatches(["cells"], "k", cell, { kind: "set", rung: { value } });

describe("one staged value per cell", () => {
  it("the schema has no suggestion lane", () => {
    expect(cellSchema.safeParse({ suggestion: { value: "x" } }).success).toBe(false);
    expect(cellSchema.safeParse({ edit: { value: "x", by: "pea" } }).success).toBe(true);
    expect(
      applyPatches(spec, envelope({}), "pea", [{ path: ["cells", "k", "suggestion"], value: { value: "x" } }], 3),
    ).toMatchObject({ ok: false });
  });

  it("a Pea set lands staged with Pea as author; last writer wins and the author follows", () => {
    const pea = land(envelope({}), "pea", set({}, "a"));
    expect(pea.doc.cells.k?.edit).toMatchObject({ value: "a", by: "pea" });
    const human = land(pea, "human", set(pea.doc.cells.k!, "b"));
    expect(human.doc.cells.k?.edit).toMatchObject({ value: "b", by: "human" });
    // Pea may overwrite a person's staged value (ADR 0030 rule 8).
    const again = land(human, "pea", set(human.doc.cells.k!, "c"));
    expect(again.doc.cells.k?.edit).toMatchObject({ value: "c", by: "pea" });
  });

  it("a set equal to the baseline stages nothing", () => {
    expect(
      cellPatches(["cells"], "k", {}, { kind: "set", rung: { value: "m" }, baseline: { value: "m" } }),
    ).toEqual([{ path: ["cells", "k", "edit"], value: null }]);
  });

  it("retire clears only the consumed value; a later writer's value survives", () => {
    const consumed = { value: "a" };
    expect(cellPatches(["cells"], "k", { edit: { value: "a" } }, { kind: "retire", consumed })).toEqual([
      { path: ["cells", "k", "edit"], value: null },
    ]);
    expect(cellPatches(["cells"], "k", { edit: { value: "b" } }, { kind: "retire", consumed })).toEqual([]);
  });
});

describe("batch review reads the same cells", () => {
  const cells: Record<string, CellLike> = {
    a: { edit: { value: "x", by: "pea" } },
    b: { edit: { value: "x", by: "human" } },
    c: {},
    d: { edit: { value: "y", by: "pea" } },
  };

  it("clearAll is one write over staged, unlocked keys", () => {
    const out = clearAll(cells, ["a", "c", "d"], {
      cellsPath: ["cells"],
      lockOf: (key) => (key === "d" ? "read-only" : null),
    });
    expect(out.covered).toEqual(["a"]);
    expect(out.skipped).toEqual([
      { key: "c", reason: "no-edit" },
      { key: "d", reason: "locked" },
    ]);
    expect(applyPatches(spec, envelope(cells, 4), "human", out.patches, 3)).toMatchObject({
      ok: false,
      code: "stale_revision",
    });
  });

  it("summarize counts staged cells and who wrote them last", () => {
    const { groups } = summarize(cells, { groupOf: () => ["g"], baselineOf: () => "m" });
    expect(groups).toEqual([
      {
        path: ["g"],
        staged: 3,
        byPea: 2,
        locked: 0,
        digest: { many: { count: 2, examples: ["x", "y"] } },
      },
    ]);
  });
});
