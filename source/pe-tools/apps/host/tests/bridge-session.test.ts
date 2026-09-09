import { computeBridgeSessionId } from "@pe/host-contracts/contracts";
import { expect, test } from "vite-plus/test";
import {
  inferCustody,
  normalizeSessionLane,
  resolveSessionTarget,
  type SessionTargetCandidate,
} from "../src/bridge.ts";

function candidate(overrides: Partial<SessionTargetCandidate>): SessionTargetCandidate {
  return {
    sessionId: "session-x",
    processId: 100,
    lane: null,
    sdkSessionId: null,
    documents: [],
    ...overrides,
  };
}

// No sdkSessionId ⇒ custody `observed`: pe-revit launched neither of these and holds no receipt.
const dev = candidate({
  sessionId: "session-dev",
  processId: 111,
  lane: "dev",
  documents: ["C:ModelsA.rvt"],
});
const installed = candidate({
  sessionId: "session-inst",
  processId: 222,
  lane: "installed",
  documents: ["C:ModelsA.rvt"],
});
// Launched by pe-revit: it reported the session id from its launch receipt ⇒ custody `controlled`.
const controlled = candidate({
  sessionId: "session-ctl",
  processId: 333,
  lane: "installed",
  sdkSessionId: "scratch-a",
});

test("session id is a stable hash of pid + processStartUtc", async () => {
  const first = await computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_000,
  });
  const again = await computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_000,
  });
  const otherStart = await computeBridgeSessionId({
    processId: 4242,
    processStartUtcUnixMs: 1_752_000_000_001,
  });
  const otherPid = await computeBridgeSessionId({
    processId: 4243,
    processStartUtcUnixMs: 1_752_000_000_000,
  });

  expect(first).toMatch(/^session-[0-9a-f]{16}$/);
  expect(again).toBe(first); // same process incarnation → same id across reconnects
  expect(otherStart).not.toBe(first); // restart overlap must never alias old/new
  expect(otherPid).not.toBe(first);
});

test("session id is absent without process identity (uuid fallback stays)", async () => {
  expect(await computeBridgeSessionId({ processId: 4242 })).toBeNull();
  expect(await computeBridgeSessionId({ processId: 4242, processStartUtcUnixMs: null })).toBeNull();
  expect(await computeBridgeSessionId({ processId: 4242, processStartUtcUnixMs: 0 })).toBeNull();
});

test("lane is the SDK union or nothing; a retired value is refused, not carried", () => {
  expect(normalizeSessionLane("dev")).toBe("dev");
  expect(normalizeSessionLane("Dev")).toBe("dev");
  expect(normalizeSessionLane("installed")).toBe("installed");
  // The retired word must not survive as a third lane value in this broker.
  expect(normalizeSessionLane("Sandbox")).toBeNull();
  expect(normalizeSessionLane("whatever")).toBeNull();
  expect(normalizeSessionLane(null)).toBeNull();
  expect(normalizeSessionLane("  ")).toBeNull();
});

test("custody is disclosed from the reported pe-revit session id, never guessed", () => {
  expect(inferCustody(controlled)).toBe("controlled");
  expect(inferCustody(dev)).toBe("observed");
  expect(inferCustody(installed)).toBe("observed");
});

test("untargeted resolution: none, implicit single, hard-fail on several", () => {
  expect(resolveSessionTarget([], undefined)._tag).toBe("none");

  const single = resolveSessionTarget([dev], undefined);
  expect(single).toMatchObject({ _tag: "found", session: dev });

  const ambiguous = resolveSessionTarget([dev, installed], undefined);
  expect(ambiguous._tag).toBe("error");
  if (ambiguous._tag === "error") {
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.message).toContain("'observed'");
    expect(ambiguous.message).toContain("'controlled'");
    expect(ambiguous.message).toContain("session-dev");
    expect(ambiguous.message).toContain("session-inst");
    expect(ambiguous.message).toContain("target=");
  }
});

test("'dev' succeeds only when exactly one dev-lane session exists", () => {
  expect(resolveSessionTarget([dev, installed], "dev")).toMatchObject({
    _tag: "found",
    session: dev,
  });
  expect(resolveSessionTarget([installed], "dev")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
  const twoDev = resolveSessionTarget(
    [dev, candidate({ sessionId: "session-dev2", processId: 112, lane: "dev" })],
    "dev",
  );
  expect(twoDev).toMatchObject({ _tag: "error", statusCode: 409 });
});

test("custody selectors resolve on the SDK's own words", () => {
  expect(resolveSessionTarget([dev, controlled], "controlled")).toMatchObject({
    _tag: "found",
    session: controlled,
  });
  expect(resolveSessionTarget([dev, controlled], "observed")).toMatchObject({
    _tag: "found",
    session: dev,
  });
  expect(resolveSessionTarget([controlled], "observed")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
  expect(resolveSessionTarget([dev, installed], "observed")).toMatchObject({
    _tag: "error",
    statusCode: 409,
  });
});

test("'session:<id>' resolves the connection reporting that pe-revit session id", () => {
  expect(resolveSessionTarget([dev, controlled], "session:scratch-a")).toMatchObject({
    _tag: "found",
    session: controlled,
  });
  expect(resolveSessionTarget([dev, controlled], "session:missing")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
});

test("the retired selector words no longer resolve anything", () => {
  // 'user' and 'sandbox:<id>' are gone. They must MISS rather than silently mean something
  // else — the silent-drift failure this cutover exists to end.
  for (const retired of ["user", "sandbox:scratch-a"])
    expect(resolveSessionTarget([dev, controlled], retired)).toMatchObject({
      _tag: "error",
      statusCode: 404,
    });
});

test("pid and raw session id target one process incarnation", () => {
  expect(resolveSessionTarget([dev, installed], "222")).toMatchObject({
    _tag: "found",
    session: installed,
  });
  expect(resolveSessionTarget([dev, installed], "999")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
  expect(resolveSessionTarget([dev, installed], "session-dev")).toMatchObject({
    _tag: "found",
    session: dev,
  });
  const miss = resolveSessionTarget([dev, installed], "session-unknown");
  expect(miss).toMatchObject({ _tag: "error", statusCode: 404 });
  if (miss._tag === "error") expect(miss.message).toContain("target=");
});

test("doc:<Address> resolves the one holder, refuses none, and refuses two by naming them", () => {
  const solo = candidate({ sessionId: "session-solo", processId: 444, documents: ["C:B.rvt"] });
  const found = resolveSessionTarget([dev, installed, solo], "doc:C:B.rvt");
  expect(found).toEqual({ _tag: "found", session: solo });
  const none = resolveSessionTarget([dev, installed, solo], "doc:C:Nobody.rvt");
  expect(none).toMatchObject({ _tag: "error", statusCode: 404 });
  const two = resolveSessionTarget([dev, installed, solo], "doc:C:ModelsA.rvt");
  expect(two).toMatchObject({ _tag: "error", statusCode: 409 });
  if (two._tag !== "error") throw new Error("expected refusal");
  expect(two.message).toContain("session-dev");
  expect(two.message).toContain("session-inst");
  expect(two.message).not.toContain("session-solo");
});

test("pin:<id>|doc:<Address> wins while the pin holds the document, else the doc: rules run", () => {
  const a = candidate({
    sessionId: "s-a",
    processId: 1,
    sdkSessionId: "pe-a",
    documents: ["C:A.rvt"],
  });
  const b = candidate({
    sessionId: "s-b",
    processId: 2,
    sdkSessionId: "pe-b",
    documents: ["C:A.rvt"],
  });
  const c = candidate({
    sessionId: "s-c",
    processId: 3,
    sdkSessionId: "pe-c",
    documents: ["C:B.rvt"],
  });
  // Two holders and the pin is one of them: the pin wins.
  expect(resolveSessionTarget([a, b, c], "pin:pe-b|doc:C:A.rvt")).toEqual({
    _tag: "found",
    session: b,
  });
  // The pin moved on (c holds B, not A) and one other holds A: the holder wins, the pin is ignored.
  expect(resolveSessionTarget([a, c], "pin:pe-c|doc:C:A.rvt")).toEqual({
    _tag: "found",
    session: a,
  });
  // The pin moved on and two others hold A: ambiguous, naming the holders and not the pin.
  const two = resolveSessionTarget([a, b, c], "pin:pe-c|doc:C:A.rvt");
  expect(two).toMatchObject({ _tag: "error", statusCode: 409 });
  if (two._tag !== "error") throw new Error("expected refusal");
  expect(two.message).toContain("s-a");
  expect(two.message).not.toContain("s-c");
  // Nobody holds it: unheld, 404, whatever the pin says.
  expect(resolveSessionTarget([c], "pin:pe-c|doc:C:A.rvt")).toMatchObject({
    _tag: "error",
    statusCode: 404,
  });
});
