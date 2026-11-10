import { testHostInputs, journalAt, callRouteOver } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { NodeServices } from "@effect/platform-node";
import { expect, test } from "vite-plus/test";
import { BridgeError as DispatchBridgeError } from "@pe/host-internal/dispatch";
import { BridgeError, RevitBridge, RevitBridgeLive } from "../src/bridge.ts";
import { StepFailure } from "../src/command-executor.ts";
import { serveRoutes } from "./real-server.ts";
import { settle } from "./effect-test.ts";

async function failedCall(error: unknown) {
  const root = await mkdtemp(join(tmpdir(), "pe-notdisp-"));
  const scope = Scope.makeUnsafe();
  let dispatches = 0;
  try {
    // Real bridge service, with no Revit attached. Only the operation result is fault-injected.
    const context = await settle(
      Layer.buildWithScope(RevitBridgeLive.pipe(Layer.provide(NodeServices.layer)), scope),
    );
    const server = await serveRoutes(
      callRouteOver(
        journalAt(join(root, "journal.jsonl"), Date.now),
        undefined,
        {},
        {
          dispatch: () => {
            dispatches++;
            return Effect.fail(error);
          },
          captureHostOp: () => {},
        },
      ).pipe(Layer.provide(testHostInputs)),
      Context.get(context, RevitBridge),
    );
    try {
      const response = await fetch(`${server.base}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "pod.list" }),
      });
      const body: unknown = await response.json();
      expect(dispatches).toBe(1);
      return { status: response.status, headers: response.headers, body };
    } finally {
      await server.close();
    }
  } finally {
    await settle(Scope.close(scope, Exit.void));
    await rm(root, { recursive: true, force: true });
  }
}
test.each([
  {
    problem: "native.response",
    status: 502,
    message: "after send",
    evidence: { dispatched: true },
  },
  { problem: "unknown", status: 503, message: "unknown provenance" },
  new BridgeError("native failed", 500, { dispatched: true, nativeOutcome: "Failed" }),
  new BridgeError("conflicting evidence", 500, { dispatched: true, notDispatched: true }),
  new DispatchBridgeError("journal failed after send", 503, { dispatched: true }),
  new StepFailure("native failed", 500, "failed", null, { nativeOutcome: "Failed" }),
])("/call never claims no dispatch for $message", async (error) => {
  const wire = await failedCall(error);
  expect(wire.status).toBeGreaterThanOrEqual(500);
  expect(wire.body).not.toHaveProperty("notDispatched", true);
});

test("/call preserves a typed pre-dispatch refusal's status, code and headers", async () => {
  const wire = await failedCall(
    new BridgeError("queue refused before send", 423, {
      notDispatched: true,
      nativeOutcome: "RefusedQueueUnresponsive",
    }),
  );
  expect(wire.status).toBe(423);
  expect(wire.body).toEqual({
    kind: "BridgeBusy",
    message: "queue refused before send",
    status: 423,
    nativeOutcome: "RefusedQueueUnresponsive",
    notDispatched: true,
  });
  expect(wire.headers.get("content-type")).toBe("application/problem+json");
  expect(wire.headers.get("retry-after")).toBeNull();
  expect(wire.headers.get("x-pe-refusal")).toBeNull();
});
