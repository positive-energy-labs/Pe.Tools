import { expect, test } from "vite-plus/test";
import { actionReceiptSchema, type Touched } from "@pe/agent-contracts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

const lost = {
  id: "capture-step", key: "revit.context.view-image", kind: "native" as const,
  input: {}, state: "unknown" as const, error: "socket killed", status: 503,
};
const view = { documentKey: "model", uniqueId: "view-unique", id: 42 };
const sources = { threads: [], works: [], machine: null, stored: [], held: [] };
test.each<Touched>([
  { kind: "restoreFailed", views: [{ view, left: ["crop", "scopeBox"] }] },
  { kind: "unauthorized", transactions: ["unexpected"], added: 0, modified: 1, deleted: 0 },
  { kind: "unknown", reason: "lost-response" },
])("recovered focused capture posts exactly one terminal notice: $kind", async (touched) => {
  const unauthorized = touched.kind === "unauthorized";
  const read = async () => sdkEnvelope({
    requestId: lost.id, state: unauthorized ? "failed" : "ok",
    receipt: { ...originalProcess, requestId: lost.id, key: lost.key, verdict: unauthorized ? "failed" : "ok" },
    response: unauthorized ? { error: "unauthorized", statusCode: 500, touched } : { payload: { image: "capture.png" }, touched,
      evidence: { documentKey: "model", revision: 4, capture: "focus" } },
  });
  const recovered = await readNativeReceipt(lost, originalProcess, read);
  expect(recovered.step).toMatchObject({ state: unauthorized ? "failed" : "succeeded", touched,
    ...(unauthorized ? {} : { result: { image: "capture.png" }, nativeEvidence: { revision: 4, capture: "focus" } }) });
  const receipt = actionReceiptSchema.parse({
    id: "capture", key: lost.key, ...(unauthorized ? { state: "failed", error: "unauthorized", status: 500 } : { state: "succeeded", result: {} }), caller: { kind: "human", via: "local" },
    basis: null, target: { kind: "host" }, input: {}, steps: [recovered.step],
    prepared: { state: "ready", value: null }, recovery: [], startedAt: "2026-11-12T00:00:00Z",
  });
  const rows = noticeRows({ ...sources, receipts: [{ revision: 1, action: receipt }] }, 0);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ key: "native:capture-step", verb: touched.kind });
  // Re-reading the same terminal projects the same notice identity, never a second post.
  expect(noticeRows({ ...sources, receipts: [{ revision: 2, action: receipt }] }, 1)).toEqual(rows);
});

test("recovered restored capture is quiet; a bare payload cannot prove restoration", async () => {
  const read = (response: unknown) => async () => sdkEnvelope({
    requestId: lost.id, state: "ok",
    receipt: { ...originalProcess, requestId: lost.id, key: lost.key, verdict: "ok" }, response,
  });
  expect((await readNativeReceipt(lost, originalProcess, read({ image: "untrusted" }))).step).toEqual(lost);
  expect((await readNativeReceipt(lost, originalProcess,
    read({ payload: null, touched: { kind: "restored", views: [view] } }))).step)
    .toMatchObject({ state: "succeeded", result: null, touched: { kind: "restored", views: [view] } });
});
