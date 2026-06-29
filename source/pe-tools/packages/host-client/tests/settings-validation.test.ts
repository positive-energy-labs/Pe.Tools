import { expect, test } from "vite-plus/test";
import { validateSettingsDocument } from "../src/settings-validation.js";

// A JSON Schema shaped like NJsonSchema's output from C# DataAnnotations
// (`[Range(1,100)]` → minimum/maximum, `[Required]` → required) plus an `x-ui`
// extension keyword the validator must ignore.
const schemaJson = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["maxEntries"],
  properties: {
    maxEntries: { type: "integer", minimum: 1, maximum: 100 },
    name: { type: "string", minLength: 1 },
  },
  "x-ui": { renderer: "table" },
});

test("a valid document passes with no issues", () => {
  const result = validateSettingsDocument(schemaJson, { maxEntries: 10, name: "ok" });
  expect(result.isValid).toBe(true);
  expect(result.issues).toEqual([]);
});

test("an out-of-range value surfaces the maximum constraint", () => {
  const result = validateSettingsDocument(schemaJson, { maxEntries: 999, name: "ok" });
  expect(result.isValid).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain("maximum");
});

test("a missing required field surfaces", () => {
  const result = validateSettingsDocument(schemaJson, { name: "x" });
  expect(result.isValid).toBe(false);
  expect(result.issues.some((issue) => issue.code === "required")).toBe(true);
});

test("an invalid schema surfaces as a validation issue", () => {
  const result = validateSettingsDocument("{", {});
  expect(result.isValid).toBe(false);
  expect(result.issues[0]?.code).toBe("schema_compile");
});
