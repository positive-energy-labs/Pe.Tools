import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riderBridgeSyncRuntimeFreshness } from "../tools/dev/rider/bridge.js";

describe("RiderBridge sync freshness", () => {
  it("reports disabled Apply Changes as unavailable instead of stale", () => {
    const freshness = riderBridgeSyncRuntimeFreshness(false, {
      ok: true,
      operation: "hot-reload",
      restartRecommended: true,
      results: [
        { actionId: "ActivateCommitToolWindow", status: "invoked", ok: true },
        { actionId: "Synchronize", status: "invoked", ok: true },
        {
          actionId: "RiderDebuggerApplyEncChagnes",
          status: "disabled",
          ok: false,
          message: "Action is registered but disabled for the current Rider context.",
        },
      ],
    });

    assert.equal(freshness.verdict, "unavailable");
    assert.equal(freshness.sourceDeltaVerdict, "unavailable");
    assert.match(freshness.basis, /no Rider-driven RRD debug session/i);
  });

  it("still reports real failed hot reload actions as stale", () => {
    const freshness = riderBridgeSyncRuntimeFreshness(false, {
      ok: false,
      operation: "hot-reload",
      restartRecommended: false,
      results: [{ actionId: "Synchronize", status: "failed", ok: false, message: "boom" }],
    });

    assert.equal(freshness.verdict, "stale");
    assert.equal(freshness.sourceDeltaVerdict, "stale");
  });
});
