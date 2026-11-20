import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { message } from "../src/route-state.ts";

it("a ZodError reads as one line of field problems, not its pretty JSON issue list", () => {
  // The shape a real pe_find repeated on every call: a Pod route declaration written for another schema.
  const route = z.strictObject({ artifact: z.string(), fingerprint: z.string() });
  const failed = route.safeParse({ sourcePath: "src/x.cs" });
  expect(failed.success).toBe(false);
  const text = message(failed.error);
  expect(text).toBe(
    "artifact is missing; fingerprint is missing; (root) has unknown field sourcePath",
  );
  expect(text).not.toContain("\n");
});

it("other errors keep their own message", () => {
  expect(message(new Error("boom"))).toBe("boom");
  expect(message("plain")).toBe("plain");
});
