import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { nativeReceiptResponseSchema } from "../src/action-receipts.ts";

// The C# twin (Pe.Shared.Tests OpReceiptResponseTests) asserts the bridge writes exactly these bytes.
const fixture: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(new URL("./fixtures/receipt-response.fixture.json", import.meta.url), "utf8"),
);

test("every receipt response the bridge writes round-trips with nothing dropped", () => {
  for (const [name, response] of Object.entries(fixture))
    if (name.startsWith("refused-"))
      expect(nativeReceiptResponseSchema.safeParse(response).success, name).toBe(false);
    else expect(nativeReceiptResponseSchema.parse(response), name).toEqual(response);
});

test("a response without touched, or a success that also says error, is refused", () => {
  const ok = fixture["ok-none"]!;
  expect(nativeReceiptResponseSchema.safeParse({ payload: ok.payload }).success).toBe(false);
  expect(nativeReceiptResponseSchema.safeParse({ ...ok, error: "x" }).success).toBe(false);
  expect(
    nativeReceiptResponseSchema.safeParse({ ...ok, touched: { kind: "restored" } }).success,
  ).toBe(false);
});
