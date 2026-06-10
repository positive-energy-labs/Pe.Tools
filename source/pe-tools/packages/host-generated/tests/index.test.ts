import { expect, test } from "vite-plus/test";
import { hostOperations } from "../src/contracts/index.ts";

test("exports generated host operation contracts", () => {
  expect(hostOperations["host.logs"].route).toBe("/api/settings/logs");
});
