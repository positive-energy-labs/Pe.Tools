import { expect, test } from "vite-plus/test";
import { shouldTakeOverCurrentHost } from "../src/host-ownership.ts";

test("only explicit dev startup replaces a running dev host", () => {
  expect(shouldTakeOverCurrentHost("installed", false)).toBe(true);
  expect(shouldTakeOverCurrentHost("dev", false)).toBe(false);
  expect(shouldTakeOverCurrentHost("dev", true)).toBe(true);
});
