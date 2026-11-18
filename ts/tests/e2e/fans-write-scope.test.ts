import { expect, test } from "vite-plus/test";
import { pickFansWriteScope } from "./fans-write-scope.ts";

test("write scope selects the known unit when its mark is absent", async () => {
  process.env.E2E_UNIT_ID = "8775469";
  const choices = ["None", "unit 8775469 · 4 staged", "unit 8775468 · 4 staged"];
  const pressed: string[] = [];
  try {
    await pickFansWriteScope("B160E75RS", async (_, pattern) => {
      const choice = choices.find(label => new RegExp(pattern).test(label));
      expect(choice).toBeDefined();
      if (choice) pressed.push(choice);
    }, async (_, pattern) => { expect(new RegExp(pattern).test(choices[1] ?? "")).toBe(true); });
    expect(pressed).toEqual(["None", choices[1]]);
  } finally { delete process.env.E2E_UNIT_ID; }
});
