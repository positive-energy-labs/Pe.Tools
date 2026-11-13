import { expect, test } from "vite-plus/test";
import { actionReceiptSchema, actionStepSchema, type Touched } from "@pe/agent-contracts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

const lost = {
  id: "capture-step", key: "revit.context.view-image", kind: "native" as const,
  input: {}, state: "unknown" as const, error: "socket killed", status: 503,
};
const view = { documentKey: "model", uniqueId: "view-unique", id: 42 };
const sources = { threads: [], works: [], machine: null, stored: [], held: [] };
const touchedCases: Touched[] = [
  { kind: "restoreFailed", views: [{ view, left: ["crop", "scopeBox"] }] },
  { kind: "unauthorized", transactions: ["unexpected"], added: 0, modified: 1, deleted: 0 },
  { kind: "unknown", reason: "lost-response" },
];
test.each((["bridge", "sdk"] as const).flatMap((transport) =>
  touchedCases.map((touched) => ({ transport, touched })),
))("$transport recovered focused capture posts exactly one terminal notice: $touched.kind", async ({ transport, touched }) => {
  const unauthorized = touched.kind === "unauthorized";
  const read = async () => sdkEnvelope({
    requestId: lost.id, state: unauthorized ? "failed" : "ok",
    receipt: { ...originalProcess, requestId: lost.id, key: lost.key, verdict: unauthorized ? "failed" : "ok" },
    response: unauthorized ? { error: "unauthorized", statusCode: 500, touched } : { payload: { image: "capture.png" }, touched,
      evidence: { documentKey: "model", revision: 4, capture: "focus" } },
  });
  const recovered = await readNativeReceipt(actionStepSchema.parse({ ...lost, transport }), originalProcess, read);
  expect(recovered.step).toMatchObject({ transport, state: unauthorized ? "failed" : "succeeded", touched,
    ...(unauthorized ? {} : { result: { image: "capture.png" }, nativeEvidence: { revision: 4, capture: "focus" } }) });
  const receipt = actionReceiptSchema.parse({
    id: "capture", key: lost.key, ...(unauthorized ? { state: "failed", error: "unauthorized", status: 500 } : { state: "succeeded", result: {} }), caller: { kind: "human", via: "local" },
    basis: null, target: { kind: "host" }, input: {}, steps: [recovered.step],
    prepared: { state: "ready", value: null }, recovery: [], startedAt: "2026-11-12T00:00:00Z",
  });
  const rows = noticeRows({ ...sources, receipts: [{ revision: 1, action: receipt }] }, 0);
  expect(rows.filter((row) => row.key === "native:capture-step"))
    .toMatchObject([{ verb: touched.kind }]);
  expect(rows).toHaveLength(unauthorized ? 2 : 1);
  if (unauthorized) expect(rows[0]).toMatchObject({ key: "action:capture", verb: "failed" });
  // src/action-journal.ts ActionJournal.invoke mints step.id with randomUUID() for the SDK requestId; resumes keep
  // those steps under the same receipt id. Thus native:${step.id} identifies one terminal.
  const next = noticeRows({ ...sources, receipts: [{ revision: 2, action: receipt }] }, 1);
  expect(next.filter((row) => row.key === "native:capture-step"))
    .toEqual(rows.filter((row) => row.key === "native:capture-step"));
  if (unauthorized) expect(next.find((row) => row.key === "action:capture")?.revision).toBe(2);
});

test.each(["failed", "incomplete"])("native unknown appends to the %s parent notice", (state) => {
  const receipt = actionReceiptSchema.parse({
    id: "parent", key: "revit.context.view-image", state,
    error: "session.bootstrap-missing: add-in not installed", status: 503,
    ...(state === "incomplete" ? { result: null } : {}),
    caller: { kind: "human", via: "local" }, basis: null, target: { kind: "host" }, input: {},
    steps: [
      { id: "copy-step", key: "copy", kind: "file", input: {}, state: "succeeded", result: { copied: "local.rvt" } },
      { ...lost, transport: "bridge", touched: { kind: "unknown", reason: "lost-response" } },
      ...(state === "incomplete" ? [{ id: "refused-step", key: "launch", kind: "native", input: {},
        state: "failed", error: "add-in not installed", status: 409, notDispatched: true }] : []),
    ],
    prepared: { state: "ready", value: null }, recovery: [], startedAt: "2026-11-12T00:00:00Z",
  });
  const rows = noticeRows({ ...sources, receipts: [{ revision: 3, action: receipt }] }, 0);
  expect(rows.find((row) => row.key === "native:capture-step"))
    .toMatchObject({ revision: 0, verb: "unknown" });
  const parent = rows.find((row) => row.key === "action:parent");
  if (state === "incomplete") expect(parent?.says).toContain("clean up before running it again");
  expect(parent).toMatchObject({ revision: 3, url: "/settings?section=%22revit%22#align-addins" });
  expect(rows).toHaveLength(2);
  const next = noticeRows({ ...sources, receipts: [{ revision: 4, action: receipt }] }, 1);
  expect(next.find((row) => row.key === "action:parent")?.revision).toBe(4);
  expect(next.find((row) => row.key === "native:capture-step"))
    .toEqual(rows.find((row) => row.key === "native:capture-step"));
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
