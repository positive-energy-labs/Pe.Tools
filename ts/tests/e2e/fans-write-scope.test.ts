import { expect, test, vi } from "vite-plus/test";
import { pickFansWriteScope } from "./fans-write-scope.ts";

const pick = async (
  unitId: string,
  choices = ["None", "unit 8775469 · 4 staged", "unit 8775468 · 4 staged"],
) => {
  const pressed: string[] = [];
  await pickFansWriteScope(
    "B160E75RS",
    async (_, pattern) => {
      const choice = choices.find((label) => new RegExp(pattern).test(label));
      if (!choice) throw Error("WRITE_SCOPE_OPTION_MISSING");
      pressed.push(choice);
    },
    async (_, pattern) => {
      expect(new RegExp(pattern).test(pressed.at(-1)!)).toBe(true);
    },
    unitId,
  );
  return pressed;
};

test("write scope selects the passed unit id", async () => {
  expect(await pick("8775469")).toEqual(["None", "unit 8775469 · 4 staged"]);
});

// The option the real page offered at 45c670d4 (c2-jv1-actual-scope-options): a zero count, and the
// row's own subline inside its text.
test("write scope selects the observed zero-staged option", async () => {
  const observed = "unit 8775469 · 0 staged\nWrite this fan's walk and its staged cells";
  expect(await pick("8775469", ["None", observed])).toEqual(["None", observed]);
});

test("write scope refuses when no option carries the passed id", async () => {
  await expect(pick("999")).rejects.toThrow("WRITE_SCOPE_OPTION_MISSING");
});

test("write scope ignores E2E_UNIT_ID and refuses a missing read id", async () => {
  vi.stubEnv("E2E_UNIT_ID", "8775468");
  try {
    expect(await pick("8775469")).toEqual(["None", "unit 8775469 · 4 staged"]);
    await expect(pick(undefined!)).rejects.toThrow("WRITE_SCOPE_UNIT_ID_MISSING");
  } finally {
    vi.unstubAllEnvs();
  }
});
