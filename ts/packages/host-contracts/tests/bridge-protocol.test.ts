import { expect, test } from "vite-plus/test";
import { Schema } from "effect";
import { bridgeFrameSchema, bridgeInFlightSnapshotSchema } from "../src/contracts/bridge-protocol.ts";
const decode = Schema.decodeUnknownSync(bridgeFrameSchema);
const terminal = { requestId: "host-request", outcome: "Succeeded", startedAtUnixMs: 100, completedAtUnixMs: 200, receiptId: "host-request" };

test("legacy registration bytes have no idle evidence; missing arrays default empty", () => {
  const state = {
    activeDocumentIsFamilyDocument: false, activeDocumentIsModelInCloud: false,
    activeDocumentIsWorkshared: false, activeDocumentObservedAtUnixMs: 0,
    hasActiveDocument: false, openDocuments: [], runtimeAssemblies: [], revitVersion: "2025", runtimeFramework: "net8",
  };
  const registration = { contractVersion: 25, processId: 42, state };
  expect(decode({kind: "Registration", registration}).registration?.inFlight).toBeNull();
  expect(Schema.decodeUnknownSync(bridgeInFlightSnapshotSchema)({ processId: 42, processStartUtcUnixMs: 10 }))
    .toEqual({ processId: 42, processStartUtcUnixMs: 10, requests: [], terminals: [] });
  expect(decode({ kind: "Response", response: { requestId: "old", ok: false, metrics: { requestBytes: 0, responseBytes: 0, revitExecutionMs: 0, roundTripMs: 0, serializationMs: 0 }, issues: [{ code: "AbandonedStillRunning", instancePath: "$", message: "busy", severity: "error" }] } }).response?.issues?.[0])
    .toMatchObject({code: "AbandonedStillRunning", instancePath: "$"});
});

test("terminal frames round trip; replay duplicates decode identically under the exact host id", () => {
  const frame = decode({ kind: "Terminal", terminal });
  const wire = Schema.encodeSync(bridgeFrameSchema)(frame);
  expect(decode(JSON.parse(JSON.stringify(wire)))).toEqual(frame);
  expect(decode({ kind: "Terminal", terminal })).toEqual(frame);
  expect(frame.terminal?.requestId).toBe("host-request");
});

test("registration carries incarnation-tagged running and pending terminal evidence", () => {
  const snapshot = { processId: 42, processStartUtcUnixMs: 10, requests: [{ requestId: "host-request", state: "AbandonedStillRunning", startedAtUnixMs: 100 }], terminals: [terminal] };
  const schema = bridgeInFlightSnapshotSchema;
  const decoded = Schema.decodeUnknownSync(schema)(snapshot);
  expect(Schema.decodeUnknownSync(schema)(Schema.encodeSync(schema)(decoded))).toEqual(snapshot);
});
