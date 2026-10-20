/**
 * The host reads its own /host/status for a Reading on the host's clock. The read forwards the
 * subscriber's browser origin, and admission refuses a browser-shaped request that does not name
 * its runtime owner (403 runtime.owner-missing), so the self-read must name this host.
 */
import { expect, test } from "vite-plus/test";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { hostOwnership } from "../src/host-ownership.ts";
import { hostResourceObserver } from "../src/resource-adapters.ts";

test("the host-status self-read names this host's runtime owner beside the forwarded origin", async () => {
  const seen: Array<Record<string, string>> = [];
  const observe = hostResourceObserver(
    undefined,
    undefined,
    undefined,
    undefined,
    async (_url, init) => {
      seen.push(Object.fromEntries(new Headers(init?.headers)));
      return Response.json({ ok: true });
    },
  );
  const frames: unknown[] = [];
  const stop = withInvocationContext(
    { headers: { origin: "http://127.0.0.1:5175" } } as never,
    () => observe({ kind: "host-status" } as never, (frame) => frames.push(frame)),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  expect(seen[0]).toMatchObject({
    origin: "http://127.0.0.1:5175",
    [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
  });
  expect(frames.length).toBeGreaterThan(0);
});
