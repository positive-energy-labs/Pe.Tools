import { describe, expect, test } from "vite-plus/test";
import { formatJson } from "./JsonBlock.tsx";

describe("formatJson", () => {
  test("keeps string previews readable", () => {
    expect(formatJson("hello")).toBe("hello");
  });

  test("formats object previews as stable JSON", () => {
    expect(formatJson({ tool: "view", ok: true })).toBe('{\n  "tool": "view",\n  "ok": true\n}');
  });
});
