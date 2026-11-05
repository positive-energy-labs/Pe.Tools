import { Context, Effect, Layer } from "effect";
import { expect } from "vite-plus/test";
import { detachedBridge, sessionView, effectTest } from "./effect-test.ts";
import { SdkSession, SdkDriver } from "../src/sdk-session.ts";
import { RevitBridge, type HostBridgeEvent } from "../src/bridge.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { replay } from "./sdk-replay.ts";

effectTest(
  "scoped SDK cache invalidates on bridge changes and never falls back across incarnations or owners",
  () =>
    Effect.gen(function* () {
      let startedAt = 1000;
      let sdkStart = 1000;
      let sourceRoot = hostOwnership.sourceRoot;
      let calls = 0;
      let changed: (() => void) | undefined;
      const bridge = detachedBridge({
        list: Effect.sync(() => [
          sessionView({
            ...hostOwnership,
            connected: true,
            sessionId: "attachment",
            processId: process.pid,
            processStartUtcUnixMs: startedAt,
            state: { openDocuments: [{ openId: "open" }] },
          }),
        ]),
        subscribe: (listener: (event: HostBridgeEvent) => void) => {
          changed = () => listener({ kind: "state-sync", sessionId: "attachment" });
          return () => {
            changed = undefined;
          };
        },
      });
      const driver = () =>
        Effect.sync(() => {
          calls++;
          return replay("doc-list", {
            result: { documents: [] },
            resolved: {
              payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
              sourceRoot,
              installedRoot: hostOwnership.installedRoot,
              pid: process.pid,
              processStartUtc: new Date(sdkStart).toISOString(),
              id: null,
              how: null,
              buildStamp: null,
              observedAtUtc: new Date(sdkStart).toISOString(),
              origin: null,
            },
          });
        });
      const services = yield* Layer.build(
        SdkSession.layer.pipe(
          Layer.provide(
            Layer.mergeAll(Layer.succeed(RevitBridge, bridge), Layer.succeed(SdkDriver, driver)),
          ),
        ),
      );
      const sdk = Context.get(services, SdkSession);
      const scope = { bridgeSessionId: "attachment", openDocumentId: "open" };
      const resolve = sdk
        .resolve(scope)
        .pipe(
          Effect.provideService(
            RequestIdentity,
            admittedRequestIdentity({ kind: "anonymous" }, scope),
          ),
        );
      expect((yield* resolve).processIncarnation).toEqual({ pid: process.pid, startedAt: 1000 });
      yield* resolve;
      expect(calls).toBe(1);
      changed!();
      yield* resolve;
      expect(calls).toBe(2);
      startedAt = 2000;
      changed!();
      expect((yield* resolve.pipe(Effect.result))._tag).toBe("Failure");
      sdkStart = 2000;
      sourceRoot = "C:/foreign-checkout";
      expect((yield* resolve.pipe(Effect.result))._tag).toBe("Failure");
    }),
);
