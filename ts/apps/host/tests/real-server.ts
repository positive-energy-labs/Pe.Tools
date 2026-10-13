import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { NodeHttpClient, NodeHttpServer } from "@effect/platform-node";
import { HttpRouter } from "effect/unstable/http";
import { productPathNames } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { makeHttpLive } from "../src/app.ts";
import { RevitBridge } from "../src/bridge.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";

/**
 * Doors driven the way a caller reaches them: a real Node server behind the real identity
 * middleware, so the body arrives on a socket callback outside the request's AsyncLocalStorage.
 * `toWebHandler` under `withInvocationContext` cannot show a caller lost after a body read.
 */
export async function serveRoutes<E, R>(
  routes: Layer.Layer<never, E, R>,
  bridge: RevitBridge["Service"],
) {
  const nodeServer = createServer();
  const port = () => {
    const address = nodeServer.address();
    return address && typeof address !== "string" ? address.port : 0;
  };
  const latch = Effect.runSync(Deferred.make<void>());
  const served = HttpRouter.serve(
    Layer.mergeAll(
      requestIdentityLayer({
        port,
        frontendOrigin: () => undefined,
        share: {
          read: async () => {
            throw Error("loopback only");
          },
          observe: () => {},
        },
      }),
      routes,
    ),
    { disableLogger: true },
  ).pipe(
    Layer.provide(Layer.succeed(RevitBridge, bridge)),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(NodeHttpServer.layer(() => nodeServer, { host: "127.0.0.1", port: 0 })),
  );
  const done = Effect.runPromise(
    Effect.raceFirst(Layer.launch(served), Deferred.await(latch)) as Effect.Effect<unknown>,
  );
  for (let i = 0; !port() && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
  return {
    base: `http://127.0.0.1:${port()}`,
    async close() {
      Effect.runSync(Deferred.succeed(latch, undefined));
      await done.catch(() => {});
    },
  };
}

/**
 * The whole host (`makeHttpLive`) on isolated state and product homes. `terminal` is the human/cli
 * context the host writes beside its receipt, as the owner's own `pea` reads it.
 */
export async function bootHost() {
  const localAppData = mkdtempSync(join(tmpdir(), "pe-host-real-"));
  const home = mkdtempSync(join(tmpdir(), "pe-host-real-home-"));
  const webDir = mkdtempSync(join(tmpdir(), "pe-host-real-web-"));
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>pe-spa</title>");
  mkdirSync(join(home, productPathNames.pagesDirectoryName, "carriage"), { recursive: true });
  writeFileSync(
    join(home, productPathNames.pagesDirectoryName, "carriage", "index.html"),
    "<!doctype html><title>carriage</title>",
  );
  const prior = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    [productPathNames.productHomeVariable]: process.env[productPathNames.productHomeVariable],
  };
  process.env.LOCALAPPDATA = localAppData;
  process.env[productPathNames.productHomeVariable] = home;
  const latch = Effect.runSync(Deferred.make<void>());
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Deferred.make<ServiceHostHandle>();
        const HttpLive = makeHttpLive({
          capabilities: { revit: true },
          port: 0,
          lifecycle: { latch, handle },
          webRoot: webDir,
        });
        yield* Effect.raceFirst(Layer.launch(HttpLive), Deferred.await(latch));
      }),
    ),
  );
  const appBase = productRoot();
  let file = await readServiceFile(appBase, hostOwnership.serviceName);
  for (let i = 0; !file && i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    file = await readServiceFile(appBase, hostOwnership.serviceName);
  }
  return {
    base: `http://127.0.0.1:${file!.port}`,
    terminal: readFileSync(hostContextTokenPath(hostOwnership.serviceName), "utf8"),
    async close() {
      Effect.runSync(Deferred.succeed(latch, undefined));
      await done.catch(() => {});
      for (const [name, value] of Object.entries(prior))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      for (const dir of [localAppData, home, webDir]) rmSync(dir, { recursive: true, force: true });
    },
  };
}
