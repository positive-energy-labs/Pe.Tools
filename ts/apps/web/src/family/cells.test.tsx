import { expect, test } from "vite-plus/test";
import { familyLockOf } from "./store";

// A shared pointer may not resolve into a drawable parameter, so keep its boundary protection narrow.
test("shared parameter directives lock descendant cells without locking local definitions", () => {
  expect(
    familyLockOf({ parameters: { $preset: "@local/_params/width" } })("/parameters/Height/value"),
  ).toContain("shared source");
  expect(familyLockOf({ parameters: { Height: { dataType: "Length", value: "12in" } } })("/parameters/Height/value")).toBeNull();
});
