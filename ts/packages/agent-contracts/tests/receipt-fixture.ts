import { receiptSchema, type Receipt } from "../src/receipts.ts";

/** Portable conformance vector: native producers use this exact wire casing and event spelling. */
export const receiptGoldenEnvelope: Receipt = receiptSchema.parse({
  schema: 1,
  id: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  at: "2026-10-13T15:00:00.000Z",
  stamp: {
    installId: "10000000-0000-4000-8000-000000000002",
    processSessionId: "10000000-0000-4000-8000-000000000003",
    component: "revit",
    lane: "dev",
    version: "0.7.22",
    build: "0.7.22.1",
    commit: "0123456789abcdef0123456789abcdef01234567",
  },
  join: { requestId: "10000000-0000-4000-8000-000000000004" },
  body: { kind: "usage", event: "app_boot", counters: { revitVersion: "2025" } },
});
