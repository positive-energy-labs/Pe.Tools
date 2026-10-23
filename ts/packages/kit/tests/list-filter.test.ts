import { describe, expect, it } from "vite-plus/test";

import { matchesListQuery as matches } from "../src/components/lang/collection";

describe("matches", () => {
  const row = { text: ["SA 19", "SupplyAir", "FC-17"], ids: [1234, 77] };
  it("needs every word, case-insensitively, in some field", () => {
    expect(matches("", row)).toBe(true);
    expect(matches("sa fc-17", row)).toBe(true);
    expect(matches("sa ex", row)).toBe(false);
  });
  it("reads an all-digit word as an element id too, exactly", () => {
    expect(matches("1234", row)).toBe(true);
    expect(matches("123", row)).toBe(false);
  });
});
