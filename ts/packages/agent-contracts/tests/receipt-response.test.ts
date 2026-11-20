import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { actionStepSchema, nativeReceiptResponseSchema } from "../src/action-receipts.ts";

// The C# twin (Pe.Shared.Tests OpReceiptResponseTests) asserts the bridge writes exactly these bytes.
const fixture: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(new URL("./fixtures/receipt-response.fixture.json", import.meta.url), "utf8"),
);

test("an SDK step needs a decoded op receipt to carry touched", () => {
  const step = {
    id: "sdk",
    key: "instances.cleanup.close",
    kind: "native",
    state: "succeeded",
    input: {},
    result: null,
  };
  const touched = { kind: "unknown", reason: "lost-response" };
  expect(actionStepSchema.safeParse({ ...step, transport: "sdk" }).success).toBe(true);
  expect(actionStepSchema.safeParse({ ...step, transport: "sdk", touched }).success).toBe(false);
  expect(actionStepSchema.safeParse({ ...step, touched }).success).toBe(false);
  expect(actionStepSchema.safeParse({ ...step, transport: "bridge", touched }).success).toBe(true);
  const op = { ...step, key: "surveys.partition" };
  const opReceipt = {
    requestId: op.id,
    key: op.key,
    pid: 42,
    processStartUtc: "2026-11-13T00:00:00Z",
    verdict: "ok",
  };
  expect(actionStepSchema.safeParse({ ...op, transport: "sdk", opReceipt, touched }).success).toBe(
    true,
  );
  expect(actionStepSchema.safeParse({ ...op, transport: "sdk", opReceipt }).success).toBe(false);
  expect(
    actionStepSchema.safeParse({ ...op, transport: "sdk", opReceipt: {}, touched }).success,
  ).toBe(false);
});

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
