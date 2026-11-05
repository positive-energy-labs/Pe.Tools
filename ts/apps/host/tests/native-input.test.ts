import { expect, test } from "vite-plus/test";
import { validateNativeInput } from "../src/native-input.ts";

test("live native schema changes cannot reuse a validator compiled for the same operation key", () => {
  const schema = (field: string) =>
    JSON.stringify({
      type: "object",
      required: [field],
      properties: { [field]: { type: "string" } },
      additionalProperties: false,
    });
  validateNativeInput("test.dynamic", { before: "one" }, schema("before"));
  expect(() => validateNativeInput("test.dynamic", { before: "one" }, schema("after"))).toThrow();
  validateNativeInput("test.dynamic", { after: "two" }, schema("after"));
});
