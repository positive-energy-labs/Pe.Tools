import { beforeEach, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { address, bindWork, commands, type ActionReceipt } from "@pe/agent-contracts";
import { bindCommands } from "./presentation";

const state = vi.hoisted(() => ({
  revision: 13,
  effects: 0,
  sent: [] as Record<string, unknown>[],
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: async (key: keyof typeof commands, input: Record<string, unknown>) => {
    const parsed = commands[key].input.parse(input) as { work?: { revision: number } };
    state.sent.push(input);
    if (parsed.work && parsed.work.revision !== state.revision)
      return {
        state: "failed",
        refusal: { kind: "stale_revision", handle: parsed.work, live: state.revision },
      };
    state.effects++;
    return { state: "succeeded", result: {} };
  },
}));
const target = { kind: "document", ref: { session: "s", openId: "d" } } as const;
const key = bindWork("families", address("C:/Review/Families.rvt"));

beforeEach(() => {
  state.revision = 13;
  state.effects = 0;
  state.sent = [];
});

test("a press retains its rendered Work revision when another writer advances the envelope", async () => {
  const refused = vi.fn();
  const bound = bindCommands(target, { key, revision: 13 }, refused);
  state.revision = 14;
  const row = await bound["families.apply"]({ include: "all" });
  expect(row.state).toBe("failed");
  expect(state.sent).toEqual([{ include: "all", work: { key, revision: 13 } }]);
  expect(state.effects).toBe(0);
  expect(refused).toHaveBeenCalledWith(row);
});

test("a bound command's literal input and result retain the portable contract types", () => {
  const bound = bindCommands(target, { key, revision: 13 }, () => {});
  const compileOnly = async () => {
    // @ts-expect-error Preview hashes remain host-owned and are not a public Apply input.
    await bound["families.apply"]({ expectedPlanHashes: { a: "h" } });
    // @ts-expect-error Families preview derives selected cells on the host; it has no include field.
    await bound["families.plan"]({ include: "all" });
    await bound["settings.write"]({
      // @ts-expect-error Save derives source bytes and hash from the reviewed Work.
      member: { pod: "p", path: "settings/x.json" },
      write: { kind: "save", sha256: "h" },
    });
    const row = await bound["family.apply"]({ include: "all" });
    if (row.state === "succeeded")
      expectTypeOf(row.result).toEqualTypeOf<import("@pe/agent-contracts").FamilyApplyResult>();
  };
  expectTypeOf(compileOnly).toBeFunction();
  expectTypeOf<Awaited<ReturnType<(typeof bound)["family.apply"]>>>().toExtend<ActionReceipt>();
});

test("optional Family observation accepts an exact source without inventing Work", async () => {
  const bound = bindCommands(target, null, () => {});
  const source = { pod: "p", path: "settings/x.json", sha256: "a".repeat(64) };
  expect(commands["family.observe"].input.safeParse({}).success).toBe(false);
  expect(commands["family.observe"].input.safeParse({ readingId: "r", source }).success).toBe(
    false,
  );
  await bound["family.observe"]({ source });
  await bound["family.observe"]({ readingId: "capture-r" });
  expect(state.sent).toEqual([{ source }, { readingId: "capture-r" }]);
  await expect(bound["family.apply"]({ include: "all" })).rejects.toThrow("Work has not been read");
});

test("Save rejects the retired caller-owned source/hash/raw grammar", () => {
  expect(
    commands["settings.write"].input.safeParse({
      member: { pod: "p", path: "settings/x.json" },
      write: { kind: "create", rawContent: "{}" },
      work: { key, revision: 13 },
    }).success,
  ).toBe(false);
  expect(commands["settings.write"].input.safeParse({ work: { key, revision: 13 } }).success).toBe(
    true,
  );
});
