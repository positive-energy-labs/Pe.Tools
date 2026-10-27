import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { fanOut, transitionPatches, draftCellSchema, type CellLike } from "./draft.ts";

const P = { value: "pea" };
const S = { value: "you" };
/** The six states the table is written against. `lock` is the reader's capability. */
const states: Record<string, { cell: CellLike; lock: string | null }> = {
  empty: { cell: {}, lock: null },
  proposed: { cell: { suggestion: P, edit: null }, lock: null },
  edit: { cell: { suggestion: null, edit: S }, lock: null },
  contested: { cell: { suggestion: P, edit: S }, lock: null },
  agreed: { cell: { suggestion: P, edit: { value: "pea" } }, lock: null },
  locked: { cell: { suggestion: P, edit: S }, lock: "read-only parameter" },
};

describe("transitionPatches: one rung per kind", () => {
  const at = (rung: string, value: unknown) => ({ path: ["cells", "k", rung], value });

  it("retire clears only rungs equal to the consumed value; a newer proposal survives", () => {
    const consumed = { value: "you" };
    expect(
      transitionPatches(["cells"], "k", states.contested!.cell, { kind: "retire", consumed }),
    ).toEqual([at("edit", null)]);
    expect(
      transitionPatches(
        ["cells"],
        "k",
        { suggestion: { value: "you" }, edit: { value: "you" } },
        {
          kind: "retire",
          consumed,
        },
      ),
    ).toEqual([at("edit", null), at("suggestion", null)]);
    expect(
      transitionPatches(
        ["cells"],
        "k",
        { suggestion: P, edit: { value: "changed" } },
        {
          kind: "retire",
          consumed,
        },
      ),
    ).toEqual([]);
  });
});

const cellSchema = draftCellSchema(z.string());
const docSchema = z.object({ cells: z.record(z.string(), cellSchema).default({}) });
const spec = {
  route: "t",
  title: "T",
  description: "t",
  schema: docSchema,

  commands: {},
} satisfies RouteStateSpec<typeof docSchema>;
const envelope = (
  cells: Record<string, CellLike>,
  revision = 3,
): RouteEnvelope<z.infer<typeof docSchema>> => ({
  version: 1,
  revision,
  doc: docSchema.parse({ cells }),
});

describe("fanOut", () => {
  const cells: Record<string, CellLike> = {
    open: { suggestion: P, edit: null },
    mine: { suggestion: P, edit: S },
    agreed: { suggestion: P, edit: { value: "pea" } },
    locked: { suggestion: { value: "q" }, edit: null },
  };
  const ctx = {
    cellsPath: ["cells"],
    actor: "human" as const,
    lockOf: (key: string) => (key === "locked" ? "read-only" : null),
  };

  it("accept covers standing proposals and skips contested, agreed, absent and locked keys with reasons", () => {
    const out = fanOut(cells, ["open", "mine", "agreed", "gone", "locked"], "take", ctx);
    expect(out.covered).toEqual(["open"]);
    expect(out.patches).toEqual([
      { path: ["cells", "open", "edit"], value: { value: "pea" } },
      { path: ["cells", "open", "suggestion"], value: null },
    ]);
    expect(out.skipped).toEqual([
      { key: "mine", reason: "contested" },
      { key: "agreed", reason: "agreed" },
      { key: "gone", reason: "no-suggestion" },
      { key: "locked", reason: "locked" },
    ]);
  });

  it("is one write: a foreign change refuses once, for every covered key", () => {
    const out = fanOut(cells, ["open", "locked"], "unsuggest", ctx);
    const refused = applyPatches(spec, envelope(cells, 4), "human", out.patches, 3);
    expect(refused).toMatchObject({ ok: false, code: "stale_revision" });
    expect(applyPatches(spec, envelope(cells, 3), "human", out.patches, 3)).toMatchObject({
      ok: true,
    });
  });
});
