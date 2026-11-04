import { Effect, Queue } from "effect";
import { expect, test } from "vite-plus/test";
import { bindActionDispatch, type DispatchRefusal } from "../src/action-dispatch.ts";
import { RevitBridgeLive } from "../src/bridge.ts";
import { connectTestBridge } from "./bridge-fixture.ts";

for (const checkpoint of ["validate", "refusal"] as const) {
  test.each([
    { kind: "cancelled", message: "rejected by you", status: 499 },
    {
      kind: "refused",
      message: "The cancel option changed",
      status: checkpoint === "validate" ? 409 : 403,
    },
  ] as const)(`${checkpoint} classifies $kind by code, not message`, ({ kind, message, status }) =>
    // effect-edge: island, phase 5
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, outgoing, target } = yield* connectTestBridge();
          const id = crypto.randomUUID();
          const refusal: DispatchRefusal = { kind, message };
          const release = bindActionDispatch(id, {
            refusal: () => (checkpoint === "refusal" ? refusal : null),
            validate: async () => (checkpoint === "validate" ? refusal : null),
            dispatched: async () => {
              throw Error("Must not dispatch");
            },
          });
          try {
            const result = yield* Effect.result(
              bridge.invoke("test.write", {}, target.session, target.openId, id),
            );
            expect(result._tag).toBe("Failure");
            if (result._tag === "Failure")
              expect(result.failure).toMatchObject({ message, statusCode: status });
            expect(yield* Queue.size(outgoing)).toBe(0);
          } finally {
            release();
          }
        }),
      ).pipe(Effect.provide(RevitBridgeLive)),
    ),
  );
}
