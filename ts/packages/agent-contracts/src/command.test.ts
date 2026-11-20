import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { z } from "zod";
import { builtinTools as tools } from "./semantic-actions.ts";
import { consumedSchema, type Command, type Consumed, type WorkHandle } from "./command.ts";
import { retainedConsumedSchema } from "./receipt-evidence.ts";
import { bindWork } from "./route-state.ts";
import { familyApplyResultSchema, type FamilyApplyResult } from "./family-actions.ts";

describe("portable tool consumers", () => {
  it("lets the host choose sealed preview hashes and rejects competing apply intent", () => {
    const input = tools.families.commands["families.apply"].input;
    const work = { key: bindWork("families", null, "reviewed"), revision: 1 };
    expect(input.parse({ work })).toEqual({ work });
    // The mode is the entry, never a flag: the write input refuses previewOnly outright.
    expect(input.safeParse({ work, previewOnly: true }).success).toBe(false);
    const preview = tools.families.commands["families.apply.preview"];
    expect(preview.writeBoundary).toMatchObject({ phase: "preview", key: "families.apply" });
    expect(preview.input.parse({ work })).toEqual({ work });
    expect(input.safeParse({ work, plan: "preview", include: ["12"] }).success).toBe(false);
    expect(
      input.safeParse({ rows: { plan: "preview", expectedPlanHashes: { "12": "forged" } } })
        .success,
    ).toBe(false);
    expect(
      input.safeParse({ plan: "preview", source: { path: "draft.json", content: "{}" } }).success,
    ).toBe(false);
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
    const apply = tools.families.commands["families.apply"];
    // The write boundary wraps the result in a preview-or-committed envelope; the committed arm keeps FamilyApplyResult.
    type Out = z.output<NonNullable<typeof apply.result>>;
    expectTypeOf<Extract<Out, { previewOnly: false }>>().toExtend<FamilyApplyResult>();
    expectTypeOf<typeof apply>().toExtend<Command>();
    expectTypeOf<
      Exclude<z.output<typeof apply.input>["work"], undefined>
    >().toEqualTypeOf<WorkHandle>();
    const handle: WorkHandle = { key: bindWork("families", null, "reviewed"), revision: 13 };
    expect(apply.work.bind({}, handle)).toEqual({ work: handle });
  });
});

describe("consumed member facts (K2)", () => {
  const member = {
    kind: "member",
    probe: { pod: "p", path: "pod.json" },
    expected: "0".repeat(64),
  } as const;
  const blob = { digest: "1".repeat(64), size: 3, fileName: "a.pdf" };
  it("refuses a member's bytes in a live fact, by type and by parse", () => {
    // @ts-expect-error a member fact names its sha alone
    const fact: Consumed = { ...member, bytesBase64: "QUJD" };
    expect(consumedSchema.safeParse(fact).success).toBe(false);
    expect(consumedSchema.safeParse({ ...member, blob }).success).toBe(false);
    expect(
      consumedSchema.safeParse({
        kind: "file",
        probe: { path: "a" },
        expected: null,
        bytesBase64: "QUJD",
      }).success,
    ).toBe(false);
  });
  it("drops the retired bytes from a fact a journal stored before, and keeps a file's blob", () => {
    expect(retainedConsumedSchema.parse({ ...member, bytesBase64: "QUJD", blob })).toEqual(member);
    const file = { kind: "file", probe: { path: "a" }, expected: null, blob };
    expect(retainedConsumedSchema.parse({ ...file, bytesBase64: "QUJD" })).toEqual(file);
  });
});
