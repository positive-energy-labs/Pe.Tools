import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import {
  availableTransitions,
  cellTransitions,
  fanOut,
  summarize,
  transitionBinding,
  transitionPatches,
  trichotomyAgentMask,
  trichotomyCellSchema,
  type TrichotomyCellLike,
  type TransitionKind,
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
const expected: Record<string, { pea: TransitionKind[]; human: TransitionKind[] }> = {
  empty: { pea: ["propose"], human: ["stage"] },
  proposed: { pea: ["propose", "withdraw"], human: ["accept", "deny", "stage"] },
  staged: { pea: ["propose"], human: ["stage", "unstage"] },
  contested: { pea: ["propose", "withdraw"], human: ["accept", "deny", "stage", "unstage"] },
  // Pea's value is what is staged: nothing stands to accept or deny.
  agreed: { pea: ["propose", "withdraw"], human: ["stage", "unstage"] },
  // Locked: only clearing a stray proposal is left.
  locked: { pea: ["withdraw"], human: ["deny"] },
};

describe("availableTransitions: every kind × state", () => {
  for (const [name, { cell, lock }] of Object.entries(states))
    for (const actor of ["pea", "human"] as const)
      it(`${name} · ${actor}`, () => {
        expect(availableTransitions(cell, actor, { baseline: undefined, lock })).toEqual(
          expected[name]![actor],
        );
      });
});

describe("transitionPatches: one rung per kind", () => {
  const cell = states.contested!.cell;
  const at = (rung: string, value: unknown) => ({ path: ["cells", "k", rung], value });
  it.each([
    [
      { kind: "propose", rung: { value: 2 }, note: "n", confidence: "low" },
      [at("proposal", { value: 2, note: "n", confidence: "low" })],
    ],
    [{ kind: "propose", rung: { delete: true } }, [at("proposal", { delete: true })]],
    [{ kind: "withdraw" }, [at("proposal", null)]],
    [{ kind: "deny" }, [at("proposal", null)]],
    // Accept stages the proposal as seen, never a value read later.
    [{ kind: "accept" }, [at("staged", { value: "pea" })]],
    [
      { kind: "stage", rung: { value: "new" }, baseline: { value: "old" } },
      [at("staged", { value: "new" })],
    ],
    [
      { kind: "stage", rung: { value: { b: 1, a: 2 } }, baseline: { value: { a: 2, b: 1 } } },
      [at("staged", null)],
    ],
    // No emptiness rule: an empty string is a value unless the baseline is empty too.
    [
      { kind: "stage", rung: { value: "" }, baseline: { value: "old" } },
      [at("staged", { value: "" })],
    ],
    [{ kind: "unstage" }, [at("staged", null)]],
  ] as const)("%j", (transition, patches) => {
    expect(transitionPatches(["cells"], "k", cell, transition as never)).toEqual(patches);
  });

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

  it("names each kind's actor and binding", () => {
    expect(Object.keys(cellTransitions)).toEqual([
      "propose",
      "withdraw",
      "accept",
      "deny",
      "stage",
      "unstage",
      "retire",
    ]);
    expect(
      (Object.keys(cellTransitions) as TransitionKind[]).map((kind) => [
        kind,
        transitionBinding(kind),
      ]),
    ).toEqual([
      ["propose", "unbound"],
      ["withdraw", "unbound"],
      ["accept", "bound"],
      ["deny", "bound"],
      ["stage", "unbound"],
      ["unstage", "unbound"],
      ["retire", "plan"],
    ]);
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

describe("pea mask", () => {
  it("lands pea's propose and withdraw, and refuses every staged rung pea could write", () => {
    const at = envelope({ k: { proposal: P, staged: null } });
    const propose = transitionPatches(
      ["cells"],
      "k",
      {},
      { kind: "propose", rung: { value: "x" } },
    );
    expect(applyPatches(spec, at, "agent", propose, 3)).toMatchObject({ ok: true });
    for (const kind of ["accept", "unstage"] as const)
      expect(
        applyPatches(
          spec,
          at,
          "agent",
          transitionPatches(["cells"], "k", at.doc.cells.k!, { kind }),
          3,
        ),
      ).toMatchObject({ ok: false, kind: "refused" });
  });

  it("the schema no longer carries proposal.by", () => {
    expect(cellSchema.parse({ proposal: { value: "x", by: "pea" } }).proposal).toEqual({
      value: "x",
    });
  });
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

  it("a single accept on a contested key still lands", () => {
    expect(
      availableTransitions(cells.mine!, "human", { baseline: undefined, lock: null }),
    ).toContain("accept");
    expect(transitionPatches(["cells"], "mine", cells.mine!, { kind: "accept" })).toEqual([
      { path: ["cells", "mine", "staged"], value: { value: "pea" } },
    ]);
  });

  it("deny clears even a locked stray proposal; unstage skips cells with nothing staged", () => {
    expect(fanOut(cells, ["open", "locked"], "deny", ctx).covered).toEqual(["open", "locked"]);
    expect(fanOut(cells, ["open", "mine"], "unstage", ctx)).toMatchObject({
      covered: ["mine"],
      skipped: [{ key: "open", reason: "no-staged" }],
    });
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

describe("summarize", () => {
  const cells: Record<string, TrichotomyCellLike> = {
    "A/1": { proposal: { value: "x" }, staged: null },
    "A/2": { proposal: { value: "y" }, staged: { value: "z" } },
    "A/3": { proposal: null, staged: { value: "w" } },
    "B/1": { proposal: { value: "7" }, staged: null },
    "B/2": { proposal: null, staged: null },
  };
  const groupOf = (key: string) => [key.split("/")[0]!];
  const baselineOf = (key: string) => (key === "B/1" ? "5" : undefined);

  it("counts per group, spans every address, and digests one change as from → to", () => {
    const { groups } = summarize(cells, {
      groupOf,
      baselineOf,
      lockOf: (key) => (key === "A/3" ? "ro" : null),
    });
    expect(groups).toEqual([
      {
        path: ["A"],
        proposed: 2,
        staged: 2,
        contested: 1,
        locked: 1,
        span: 3,
        digest: { many: { count: 3, examples: [{ to: "x" }, { to: "z" }, { to: "w" }] } },
      },
      {
        path: ["B"],
        proposed: 1,
        staged: 0,
        contested: 0,
        locked: 0,
        span: 2,
        digest: { single: { from: "5", to: "7" } },
      },
    ]);
  });
});
