import { createServer, request } from "node:http";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { mintContext, retireContext } from "../src/control.ts";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";

const turns = () =>
  Effect.promise(async () => {
    for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  });

effectTest(
  "real POST socket close interrupts native and transitional requests after their bodies completed",
  () =>
    Effect.forEach(["{}", '{"key":"revit.detail.space-scene"}'], (body) =>
      Effect.gen(function* () {
        const server = createServer();
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let interrupted = false;
        const token = mintContext({ kind: "human", via: "cli" });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            retireContext(token);
            server.closeAllConnections();
          }),
        );
        const port = () => (server.address() as import("node:net").AddressInfo).port;
        const identity = requestIdentityLayer({
          port,
          frontendOrigin: Effect.succeed(undefined),
          share: {
            read: async () => ({
              allowRemoteAdministration: false,
              desired: "off",
              state: "off",
              url: null,
              refusal: null,
              callers: [],
              refused: [],
            }),
            observe: () => {},
          },
        });
        const route = HttpRouter.add("POST", "/call", (req) =>
          Effect.gen(function* () {
            yield* req.json;
            const admitted = yield* RequestIdentity;
            expect(admitted.caller.kind).toBe("human");
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            );
            return HttpServerResponse.empty();
          }),
        );
        yield* Layer.build(
          HttpRouter.serve(route.pipe(Layer.provide(identity))).pipe(
            Layer.provide(
              NodeHttpServer.layer(() => server, {
                host: "127.0.0.1",
                port: 0,
                disablePreemptiveShutdown: true,
              }),
            ),
          ),
        );
        const outgoing = request(`http://127.0.0.1:${port()}/call`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [HOST_CONTEXT_HEADER]: token,
            [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
          },
        });
        outgoing.on("error", () => {});
        outgoing.end(body);
        yield* Deferred.await(entered);
        yield* turns();
        expect(interrupted).toBe(false); // A completed POST body must not cancel its reader.
        outgoing.destroy();
        yield* turns();
        yield* Deferred.succeed(release, undefined); // Also cleans up the deliberately broken baseline.
        expect(interrupted).toBe(true);
      }),
    ),
);

effectTest("admitted request identity is immutable and independent across suspended fibers", () =>
  Effect.gen(function* () {
    const one = admittedRequestIdentity({ kind: "anonymous" }, { bridgeSessionId: "one" });
    const two = admittedRequestIdentity({ kind: "anonymous" }, { bridgeSessionId: "two" });
    const read = Effect.gen(function* () {
      yield* Effect.yieldNow;
      return (yield* RequestIdentity).scope.bridgeSessionId;
    });
    expect(
      yield* Effect.all(
        [
          read.pipe(Effect.provideService(RequestIdentity, one)),
          read.pipe(Effect.provideService(RequestIdentity, two)),
        ],
        { concurrency: "unbounded" },
      ),
    ).toEqual(["one", "two"]);
    expect(Object.isFrozen(one.scope)).toBe(true);
    expect(Object.isFrozen(one.ownership.policy)).toBe(true);
  }),
);
