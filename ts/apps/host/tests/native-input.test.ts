import { expect, test } from "vite-plus/test";
import { nativeRequestInput, validateNativeInput } from "../src/native-input.ts";
import { workAdmissionSchema } from "@pe/agent-contracts";
import { nativeRequestSchema } from "@pe/host-contracts/decoders";

test("native projection removes exactly the admission envelope and retains strict DTO validation", () => {
  const input = { stage: "Rooms", ...Object.fromEntries(Object.keys(workAdmissionSchema.shape).map(key => [key, {}])) };
  expect(nativeRequestInput(input)).toEqual({ stage: "Rooms" });
  expect(Object.keys(input)).toContain("work");
  expect(nativeRequestSchema("takeoffs.initialize-carrier").safeParse(nativeRequestInput({ ...input, typo: true })).success).toBe(false);
});

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
