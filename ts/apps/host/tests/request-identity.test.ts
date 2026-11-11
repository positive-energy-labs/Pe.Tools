import { serviceHeaders } from "./callers.ts";
import { createServer, request } from "node:http";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect } from "vite-plus/test";
import { effectTest } from "./effect-test.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { mintContext, retireContext } from "../src/control.ts";
import { admitNativeCaller } from "../src/native-read-policy.ts";
import { HOST_CONTEXT_HEADER, HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";

effectTest("EventSource query ownership carries its minted human into native admission", () =>
  Effect.gen(function* () {
    const server = createServer();
    yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()));
    const port = () => (server.address() as import("node:net").AddressInfo).port;
    const identity = requestIdentityLayer({ port, frontendOrigin: Effect.succeed(undefined),
      share: { read: async () => { throw Error("local requests never read sharing"); }, observe: () => {} } });
    const routes = Layer.mergeAll(
      HttpRouter.add("GET", "/", () => Effect.succeed(HttpServerResponse.html("mint"))),
      HttpRouter.add("GET", "/pe/resources", () => Effect.gen(function* () {
        yield* Effect.yieldNow;
        const result = yield* Effect.result(admitNativeCaller("ducts.tables"));
        return HttpServerResponse.jsonUnsafe(result._tag === "Success"
          ? { caller: (yield* RequestIdentity).caller.kind, native: result.success.key }
          : { problem: result.failure.problem }, { status: result._tag === "Success" ? 200 : 403 });
      })),
    );
    yield* Layer.build(HttpRouter.serve(routes.pipe(Layer.provide(identity))).pipe(
      Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
    ));
    yield* Effect.promise(async () => {
      const base = `http://127.0.0.1:${port()}`;
      const nav = await fetch(base, { headers: { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
      const cookie = nav.headers.get("set-cookie")!.split(";")[0]!;
      await nav.body?.cancel();
      const headers = { cookie, referer: `${base}/fans`, "sec-fetch-site": "same-origin" };
      const send = async (query: string, extra: Record<string, string> = {}) => {
        const response = await fetch(`${base}/pe/resources${query}`, { headers: { ...headers, ...extra } });
        return { status: response.status, body: await response.json() };
      };
      const query = `?peRuntimeService=${hostOwnership.serviceName}`;
      expect(await send(query)).toEqual({ status: 200, body: { caller: "human", native: "ducts.tables" } });
      expect(await send("?peRuntimeService=foreign", { [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName })).toMatchObject({ status: 403 });
      expect(await send(query, { [HOST_RUNTIME_SERVICE_HEADER]: "foreign" })).toMatchObject({ status: 403 });
      expect(await send("")).toMatchObject({ status: 403 });
      expect(await send(query, { cookie: "" })).toEqual({ status: 403, body: { problem: "context.missing" } });
      expect(await send(query, { referer: "" })).toEqual({ status: 403, body: { problem: "context.missing" } });
      expect(await send(query, { origin: "http://127.0.0.1:5274" })).toMatchObject({ status: 403 });
    });
  }),
);

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
            ...serviceHeaders(),
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
