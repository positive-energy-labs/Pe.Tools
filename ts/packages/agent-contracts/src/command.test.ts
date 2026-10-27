import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { z } from "zod";
import { tools } from "./semantic-actions.ts";
import { editableCells, workCounts, type Command, type WorkHandle } from "./command.ts";
import { bindWork } from "./route-state.ts";
import { familyApplyResultSchema, type FamilyApplyResult } from "./family-actions.ts";
import { settingsRouteState } from "./settings.ts";

describe("portable tool consumers", () => {
  it("lets the host choose sealed preview hashes and rejects competing apply intent", () => {
    const input = tools.families.commands["families.apply"].input;
    expect(input.parse({ plan: "preview", include: ["12"] })).toEqual({
      plan: "preview",
      include: ["12"],
    });
    expect(input.parse({})).toEqual({ include: "all" });
    expect(
      input.safeParse({ rows: { plan: "preview", expectedPlanHashes: { "12": "forged" } } })
        .success,
    ).toBe(false);
    expect(
      input.safeParse({ plan: "preview", source: { path: "draft.json", content: "{}" } }).success,
    ).toBe(false);
  });

  it("counts authored cells without interpreting the user's JSON as lifecycle state", () => {
    const doc = settingsRouteState.schema.parse({
      fields: {
        "/payload": {
          edit: { value: { edit: { value: "domain data" }, suggestion: { value: 42 } } },
        },
        "/empty": {},
        "/proposed": { suggestion: { value: "inspect me" } },
      },
    });
    expect(workCounts(doc, tools.pods.work.editable)).toEqual({ proposals: 1, unfinished: 2 });
    expect(editableCells(doc, tools.pods.work.editable).map(({ path }) => path)).toEqual([
      ["fields", "/payload"],
      ["fields", "/empty"],
      ["fields", "/proposed"],
    ]);
  });

  it("preserves per-family refusal, readback failure and native evidence in a batch result", () => {
    const outcome = {
      executionContext: { session: "s", openId: "d" },
      native: {
        receipts: [
          {
            familyId: 3,
            familyName: "F",
            success: false,
            converged: false,
            residue: [],
            errors: ["refused"],
            loadedFamilyId: null,
          },
        ],
        diagnostics: [],
        receiptPath: "kept/receipt.json",
      },
      readbackError: "native apply returned; readback unavailable",
    };
    const result = familyApplyResultSchema.parse({ results: [outcome] });
    expect(result).toEqual({ results: [outcome] });
    expect(familyApplyResultSchema.safeParse({ ...outcome, native: {} }).success).toBe(false);
  });

  it("keeps command input and result types through Work binding", () => {
    const apply = tools.family.commands["family.apply"];
    expectTypeOf<z.output<NonNullable<typeof apply.result>>>().toEqualTypeOf<FamilyApplyResult>();
    expectTypeOf<typeof apply>().toExtend<Command>();
    expectTypeOf<
      Exclude<z.output<typeof apply.input>["work"], undefined>
    >().toEqualTypeOf<WorkHandle>();
    const handle: WorkHandle = { key: bindWork("family", null, "reviewed"), revision: 13 };
    expect(apply.work.bind({ include: "all" }, handle)).toEqual({ include: "all", work: handle });
    const observe = tools.family.commands["family.observe"];
    expect(observe.work.optional).toBe(true);
    expect(observe.input.parse({ readingId: "capture" })).toEqual({ readingId: "capture" });
    expect(observe.work.bind({ readingId: "capture" }, handle)).toEqual({
      readingId: "capture",
      work: handle,
    });
  });
});
