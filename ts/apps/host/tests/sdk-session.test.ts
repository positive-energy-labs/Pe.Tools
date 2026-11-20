import { Context, Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { detachedBridge, sessionView, effectTest } from "./effect-test.ts";
import { SdkSession, SdkDriver, readSessionScope } from "../src/sdk-session.ts";
import {
  HOST_RPC_SDK_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { RevitBridge, type HostBridgeEvent } from "@pe/host-internal/bridge";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import { hostOwnership } from "../src/host-ownership.ts";
import { replay } from "./sdk-replay.ts";

test("the public session header decodes exact identity without a private broker id", () => {
  const exact = { session: "sdk-session", processIncarnation: { pid: 42, startedAt: 1000 } };
  expect(
    readSessionScope({
      [HOST_RPC_SDK_SESSION_HEADER]: JSON.stringify(exact),
      [HOST_RPC_DOCUMENT_HEADER]: "open",
    }),
  ).toEqual({ session: exact, openDocumentId: "open" });
  expect(() =>
    readSessionScope({
      [HOST_RPC_SDK_SESSION_HEADER]: JSON.stringify({ ...exact, id: "mixed-selector" }),
    }),
  ).toThrow();
});

effectTest(
  "scoped SDK cache invalidates on bridge changes and never falls back across incarnations or owners",
  () =>
    Effect.gen(function* () {
      let startedAt = 1000;
      let sdkStart = 1000;
      let sourceRoot = hostOwnership.sourceRoot;
      let calls = 0;
      let changesDuringResolution = 0;
      let changed: (() => void) | undefined;
      let duplicate = false;
      const bridge = detachedBridge({
        list: Effect.sync(() => [
          sessionView({
            ...hostOwnership,
            connected: true,
            sessionId: "attachment",
            sdkSessionId: "sdk-session",
            processId: process.pid,
            processStartUtcUnixMs: startedAt,
            state: { openDocuments: [{ openId: "open" }] },
          }),
          ...(duplicate
            ? [
                sessionView({
                  ...hostOwnership,
                  connected: true,
                  sessionId: "another-attachment",
                  sdkSessionId: "sdk-session",
                  processId: process.pid + 1,
                  processStartUtcUnixMs: startedAt,
                }),
              ]
            : []),
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
          if (changesDuringResolution > 0) {
            changesDuringResolution--;
            changed!();
          }
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
      // One frame mid-admission: the SDK owner re-admits from scratch (a second SDK read) and succeeds.
      changed!();
      changesDuringResolution = 1;
      expect((yield* resolve).processIncarnation).toEqual({ pid: process.pid, startedAt: 1000 });
      expect(calls).toBe(4);
      // Frames on every pass: bounded at one re-admission, then the refusal stands.
      changed!();
      changesDuringResolution = 2;
      const raced = yield* resolve.pipe(Effect.result);
      expect(raced._tag).toBe("Failure");
      if (raced._tag === "Failure")
        expect(raced.failure.message).toContain("SDK attachment changed during resolution");
      expect(calls).toBe(6);
      const closed = { bridgeSessionId: "attachment", openDocumentId: "closed" };
      const closedRead = sdk
        .resolve(closed)
        .pipe(
          Effect.provideService(
            RequestIdentity,
            admittedRequestIdentity({ kind: "anonymous" }, closed),
          ),
          Effect.result,
        );
      expect((yield* closedRead)._tag).toBe("Failure");
      startedAt = 2000;
      changed!();
      expect((yield* resolve.pipe(Effect.result))._tag).toBe("Failure");
      sdkStart = 2000;
      sourceRoot = "C:/foreign-checkout";
      expect((yield* resolve.pipe(Effect.result))._tag).toBe("Failure");
      sourceRoot = hostOwnership.sourceRoot;
      const exact = {
        session: {
          session: "sdk-session",
          processIncarnation: { pid: process.pid, startedAt: 2000 },
        },
        openDocumentId: "open",
      };
      const exactRead = (scope: typeof exact) =>
        sdk
          .resolve(scope)
          .pipe(
            Effect.provideService(
              RequestIdentity,
              admittedRequestIdentity({ kind: "anonymous" }, scope),
            ),
          );
      expect((yield* exactRead(exact)).processIncarnation).toEqual(
        exact.session.processIncarnation,
      );
      const beforeStale = calls;
      const stale = {
        ...exact,
        session: { ...exact.session, processIncarnation: { pid: process.pid, startedAt: 1000 } },
      };
      expect((yield* exactRead(stale).pipe(Effect.result))._tag).toBe("Failure");
      expect(calls).toBe(beforeStale);
      duplicate = true;
      expect((yield* exactRead(exact).pipe(Effect.result))._tag).toBe("Failure");
      expect(calls).toBe(beforeStale);
      duplicate = false;
      expect(
        (yield* exactRead({ ...exact, openDocumentId: "closed" }).pipe(Effect.result))._tag,
      ).toBe("Failure");
    }),
);
