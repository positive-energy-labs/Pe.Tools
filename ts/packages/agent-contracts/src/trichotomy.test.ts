import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import {
  fanOut,
  transitionPatches,
  trichotomyAgentMask,
  trichotomyCellSchema,
  type TrichotomyCellLike,
} from "./trichotomy.ts";

const P = { value: "pea" };
const S = { value: "you" };
/** The six states the table is written against. `lock` is the reader's capability. */
const states: Record<string, { cell: TrichotomyCellLike; lock: string | null }> = {
  empty: { cell: {}, lock: null },
  proposed: { cell: { proposal: P, staged: null }, lock: null },
  staged: { cell: { proposal: null, staged: S }, lock: null },
  contested: { cell: { proposal: P, staged: S }, lock: null },
  agreed: { cell: { proposal: P, staged: { value: "pea" } }, lock: null },
  locked: { cell: { proposal: P, staged: S }, lock: "read-only parameter" },
};

describe("transitionPatches: one rung per kind", () => {
  const at = (rung: string, value: unknown) => ({ path: ["cells", "k", rung], value });

  it("retire clears only rungs equal to the consumed value; a newer proposal survives", () => {
    const consumed = { value: "you" };
    expect(
      transitionPatches(["cells"], "k", states.contested!.cell, { kind: "retire", consumed }),
    ).toEqual([at("staged", null)]);
    expect(
      transitionPatches(
        ["cells"],
        "k",
        { proposal: { value: "you" }, staged: { value: "you" } },
        {
          kind: "retire",
          consumed,
        },
      ),
    ).toEqual([at("staged", null), at("proposal", null)]);
    expect(
      transitionPatches(
        ["cells"],
        "k",
        { proposal: P, staged: { value: "changed" } },
        {
          kind: "retire",
          consumed,
        },
      ),
    ).toEqual([]);
  });
});

const cellSchema = trichotomyCellSchema(z.string());
const docSchema = z.object({ cells: z.record(z.string(), cellSchema).default({}) });
const spec = {
  route: "t",
  title: "T",
  description: "t",
  schema: docSchema,
  agentWriteMask: trichotomyAgentMask(),
  commands: {},
} satisfies RouteStateSpec<typeof docSchema>;
const envelope = (
  cells: Record<string, TrichotomyCellLike>,
  revision = 3,
): RouteEnvelope<z.infer<typeof docSchema>> => ({
  version: 1,
  revision,
  doc: docSchema.parse({ cells }),
});

describe("fanOut", () => {
  const cells: Record<string, TrichotomyCellLike> = {
    open: { proposal: P, staged: null },
    mine: { proposal: P, staged: S },
    agreed: { proposal: P, staged: { value: "pea" } },
    locked: { proposal: { value: "q" }, staged: null },
  };
  const ctx = {
    cellsPath: ["cells"],
    actor: "human" as const,
    lockOf: (key: string) => (key === "locked" ? "read-only" : null),
  };

  it("accept covers standing proposals and skips contested, agreed, absent and locked keys with reasons", () => {
    const out = fanOut(cells, ["open", "mine", "agreed", "gone", "locked"], "accept", ctx);
    expect(out.covered).toEqual(["open"]);
    expect(out.patches).toEqual([{ path: ["cells", "open", "staged"], value: { value: "pea" } }]);
    expect(out.skipped).toEqual([
      { key: "mine", reason: "contested" },
      { key: "agreed", reason: "agreed" },
      { key: "gone", reason: "no-proposal" },
      { key: "locked", reason: "locked" },
    ]);
  });

  it("is one write: a foreign change refuses once, for every covered key", () => {
    const out = fanOut(cells, ["open", "locked"], "deny", ctx);
    const refused = applyPatches(spec, envelope(cells, 4), "human", out.patches, 3);
    expect(refused).toMatchObject({ ok: false, code: "stale_revision" });
    expect(applyPatches(spec, envelope(cells, 3), "human", out.patches, 3)).toMatchObject({
      ok: true,
    });
  });
});
