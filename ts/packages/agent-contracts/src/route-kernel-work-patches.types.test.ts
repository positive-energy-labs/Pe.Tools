import { expect, test } from "vite-plus/test";
import { acceptedWorkPatches, rejectedWorkPatches } from "./route-kernel-work-patches.fixtures.ts";

test("schema-derived Work paths keep finite keys and values correlated", () => {
  expect(acceptedWorkPatches).toHaveLength(13);
  expect(rejectedWorkPatches).toHaveLength(12);
});
