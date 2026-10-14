import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import { claimServiceHost, type ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { HostLifecycle, adminShutdownRoute } from "../src/host-lifecycle.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { createShare, shareIntentFile, tailscaleCommand } from "../src/share.ts";

test("a published claim authorizes shutdown while its lifecycle handle is still pending", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-claim-ready-"));
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TCP listener required");
  const port = address.port;
  const handle = Effect.runSync(Deferred.make<ServiceHostHandle>());
  const latch = Effect.runSync(Deferred.make<void>());
  const claim = await claimServiceHost(root, {
    name: hostOwnership.serviceName,
    lane: "dev",
    version: "test",
    port,
    executablePath: process.execPath,
    shutdown: "/admin/shutdown",
    policy: { evicts: [] },
  });
  if (!claim.claimed) throw Error(claim.reason);
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      requestIdentityLayer({
        port: () => port,
        frontendOrigin: () => undefined,
        share: createShare({
          installed: false,
          port: () => port,
          run: tailscaleCommand(),
          ...shareIntentFile(join(root, "share.json")),
        }),
      }),
      adminShutdownRoute,
    ).pipe(Layer.provideMerge(Layer.succeed(HostLifecycle, { handle, latch }))),
    { disableLogger: true },
  );
  try {
    const file = await readServiceFile(root, hostOwnership.serviceName);
    expect(file?.token).toBe(claim.handle.serviceFile.token);
    const request = (token: string) =>
      app.handler(
        new Request(`http://127.0.0.1:${port}/admin/shutdown`, {
          method: "POST",
          headers: { host: `127.0.0.1:${port}`, "x-pe-service-token": token },
        }),
      );
    const pending = request(file!.token);
    // Let the real middleware run while the published claim's handle is unresolved.
    await new Promise<void>((resolve) => setImmediate(resolve));
    Effect.runSync(Deferred.succeed(handle, claim.handle));
    expect((await pending).status).toBe(200);
    expect((await request("wrong-token")).status).toBe(403);
    await Effect.runPromise(Deferred.await(latch));
  } finally {
    await app.dispose();
    await claim.handle.release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
