import { expect, test } from "vite-plus/test";
import {
  computeBridgeSessionId,
  normalizeSessionLane,
  resolveSessionTarget,
  type SessionTargetCandidate,
} from "../src/bridge.ts";

function candidate(overrides: Partial<SessionTargetCandidate>): SessionTargetCandidate {
  return {
    sessionId: "session-x",
    processId: 100,
    lane: null,
    sandboxId: null,
    ...overrides,
  };
}

const rrd = candidate({ sessionId: "session-rrd", processId: 111, lane: "rrd" });
const installed = candidate({ sessionId: "session-inst", processId: 222, lane: "installed" });
const sandbox = candidate({
  sessionId: "session-sbx",
  processId: 333,
  lane: "sandbox",
  sandboxId: "scratch-a",
});

test("session id is a stable hash of pid + processStartUtc", () => {
  const first = computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_000,
  });
  const again = computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_000,
  });
  const otherStart = computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_001,
  });
  const otherPid = computeBridgeSessionId({
    processId: 4243,
    processStartUtcUnixMs: 1_752_000_000_000,
  });

  expect(first).toMatch(/^session-[0-9a-f]{16}$/);
  expect(again).toBe(first); // same process incarnation → same id across reconnects
  expect(otherStart).not.toBe(first); // restart overlap must never alias old/new
  expect(otherPid).not.toBe(first);
});

test("session id is absent without process identity (uuid fallback stays)", () => {
  expect(computeBridgeSessionId({ processId: 4242 })).toBeNull();
  expect(computeBridgeSessionId({ processId: 4242, processStartUtcUnixMs: null })).toBeNull();
  expect(computeBridgeSessionId({ processId: 4242, processStartUtcUnixMs: 0 })).toBeNull();
});

test("lane normalizes SDK 'dev' into the registered rrd vocabulary", () => {
  expect(normalizeSessionLane("dev")).toBe("rrd");
  expect(normalizeSessionLane("Dev")).toBe("rrd");
  expect(normalizeSessionLane("installed")).toBe("installed");
  expect(normalizeSessionLane("Sandbox")).toBe("sandbox");
  expect(normalizeSessionLane(null)).toBeNull();
  expect(normalizeSessionLane("  ")).toBeNull();
});

test("untargeted resolution: none, implicit single, hard-fail on several", () => {
  expect(resolveSessionTarget([], undefined)._tag).toBe("none");

  const single = resolveSessionTarget([rrd], undefined);
  expect(single).toMatchObject({ _tag: "found", session: rrd });

  const ambiguous = resolveSessionTarget([rrd, installed], undefined);
  expect(ambiguous._tag).toBe("error");
  if (ambiguous._tag === "error") {
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.message).toContain("rrd holds the user's live docs");
    expect(ambiguous.message).toContain("session-rrd");
    expect(ambiguous.message).toContain("session-inst");
    expect(ambiguous.message).toContain("target=");
  }
});

test("'rrd' succeeds only when exactly one rrd session exists", () => {
  expect(resolveSessionTarget([rrd, installed], "rrd")).toMatchObject({
    _tag: "found",
    session: rrd,
  });
  expect(resolveSessionTarget([installed], "rrd")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
  const twoRrd = resolveSessionTarget(
    [rrd, candidate({ sessionId: "session-rrd2", processId: 112, lane: "rrd" })],
    "rrd",
  );
  expect(twoRrd).toMatchObject({ _tag: "error", statusCode: 409 });
});

test("'sandbox:<id>' resolves the current process session for that logical sandbox", () => {
  expect(resolveSessionTarget([rrd, sandbox], "sandbox:scratch-a")).toMatchObject({
    _tag: "found",
    session: sandbox,
  });
  expect(resolveSessionTarget([rrd, sandbox], "sandbox:missing")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
});

test("pid and raw session id target one process incarnation", () => {
  expect(resolveSessionTarget([rrd, installed], "222")).toMatchObject({
    _tag: "found",
    session: installed,
  });
  expect(resolveSessionTarget([rrd, installed], "999")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
  expect(resolveSessionTarget([rrd, installed], "session-rrd")).toMatchObject({
    _tag: "found",
    session: rrd,
  });
  const miss = resolveSessionTarget([rrd, installed], "session-unknown");
  expect(miss).toMatchObject({ _tag: "error", statusCode: 404 });
  if (miss._tag === "error") expect(miss.message).toContain("target=");
});
