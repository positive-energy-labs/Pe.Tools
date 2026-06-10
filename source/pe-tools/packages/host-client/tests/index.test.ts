import { expect, test } from "vite-plus/test";
import { PeHostClient } from "../src/index.ts";

test("resolves explicit host base URL", () => {
  expect(PeHostClient.resolveHostBaseUrl(" http://localhost:1234 ")).toBe("http://localhost:1234");
});

test("resolves a default host base URL", () => {
  expect(PeHostClient.resolveHostBaseUrl()).toMatch(/^https?:\/\//);
});
