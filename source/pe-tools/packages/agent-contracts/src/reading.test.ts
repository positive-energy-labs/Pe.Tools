import { describe, expect, it } from "vite-plus/test";

import { address, here, superseded, type Reading } from "./reading.ts";

const at = address("C:\\Models\\projectA.rvt");
const reading = (version: string | null): Reading => ({
  at,
  version,
  observedAt: "2026-08-26T00:00:00.000Z",
});

describe("Reading", () => {
  it("accepts only document identities", () => {
    expect(address("f2933e8d-9e16-4bf4-b9ca-484f461e4563")).toBe(
      "f2933e8d-9e16-4bf4-b9ca-484f461e4563",
    );
    expect(() => address("")).toThrow();
    expect(() => address("observed")).toThrow();
  });

  it("projects matching documents and detects version drift", () => {
    const value = { reading: reading("v1") };
    expect(here(value, at)).toBe(value);
    expect(here(value, null)).toBeNull();
    expect(superseded(reading("v1"), reading("v2"))).toBe(true);
  });
});
