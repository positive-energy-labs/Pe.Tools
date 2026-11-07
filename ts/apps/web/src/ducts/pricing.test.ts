import { expect, test } from "vite-plus/test";
import { pricingResult } from "@pe/ducts-domain/pricing-result";
import { noTerminalSnapshot } from "./no-terminal.fixture";
test("a fan with no terminal fails pricing with its system and open outlet, rather than waiting", () => {
  expect(() => pricingResult(noTerminalSnapshot(), {}, {}, null)).toThrow("EX 1 has no terminal: its air leaves at open end 11620957; nothing to price");
});
