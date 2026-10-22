import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { operationDefinition, requireEligibleCaller } from "../src/gateway-actions.ts";
import type { RevitBridge, HostBridgeEvent } from "../src/bridge.ts";
import type { SdkSession } from "../src/sdk-session.ts";

const target = {
  sessionId: "exact",
  processId: 42,
  processStartUtcUnixMs: 1000,
  buildStamp: "build-a",
  state: { runtimeAssemblies: [] },
} as unknown as SdkSession;
const fixture = () => {
  let listener: (event: HostBridgeEvent) => void = () => {};
  const row = {
    key: "read",
    intent: "Read",
    needs: "document",
    actor: "human",
    requestSchemaJson: "{}",
  };
  const invoke = vi.fn(() => Effect.succeed({ value: { operations: [row] }, target: null }));
  const bridge = {
    invoke,
    subscribe: (next: typeof listener) => {
      listener = next;
      return () => {};
    },
  } as unknown as RevitBridge["Service"];
  return {
    bridge,
    invoke,
    row,
    event: (kind: HostBridgeEvent["kind"]) => listener({ sessionId: "exact", kind }),
  };
};

test("one catalog acquisition per socket/build; eligibility and schema survive every lookup", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    operationDefinition("read", f.bridge, target),
    operationDefinition("read", f.bridge, target),
  ]);
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(a).toEqual(b);
  for (const definition of [a, b]) {
    expect("requestSchemaJson" in definition && definition.requestSchemaJson).toBe("{}");
    expect(() =>
      requireEligibleCaller(definition, { kind: "anonymous" } as never, "/call"),
    ).toThrow();
  }
  await operationDefinition("read", f.bridge, { ...target, buildStamp: "build-b" });
  expect(f.invoke).toHaveBeenCalledTimes(2);
  f.event("connected"); // same process/build reconnected: a different exact socket.
  await operationDefinition("read", f.bridge, { ...target, buildStamp: "build-b" });
  expect(f.invoke).toHaveBeenCalledTimes(3);
  f.event("disconnected");
  await operationDefinition("read", f.bridge, target);
  expect(f.invoke).toHaveBeenCalledTimes(4);
});

test("failed catalog acquisition is retried and malformed definitions never authorize", async () => {
  const f = fixture();
  f.invoke.mockImplementationOnce(() => Effect.fail(new Error("unavailable")) as never);
  await expect(operationDefinition("read", f.bridge, target)).rejects.toThrow("unavailable");
  await operationDefinition("read", f.bridge, target);
  expect(f.invoke).toHaveBeenCalledTimes(2);
  await expect(operationDefinition("absent", f.bridge, target)).rejects.toMatchObject({
    statusCode: 409,
  });
  f.row.intent = "unknown";
  await expect(operationDefinition("read", f.bridge, target)).rejects.toBeDefined();
});

test("late catalog from a superseded socket cannot populate or authorize its successor", async () => {
  const f = fixture();
  const pending = Promise.withResolvers<{
    value: { operations: (typeof f.row)[] };
    target: null;
  }>();
  f.invoke.mockImplementationOnce(() => Effect.promise(() => pending.promise));
  const first = operationDefinition("read", f.bridge, target);
  f.event("connected");
  pending.resolve({ value: { operations: [f.row] }, target: null });
  await expect(first).rejects.toMatchObject({ statusCode: 409 });
  await operationDefinition("read", f.bridge, target);
  expect(f.invoke).toHaveBeenCalledTimes(2);
});
