import { existsSync, readFileSync } from "node:fs";
import { Deferred, Effect, Exit, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { makeHttpLive } from "../src/app.ts";
import { callerOf } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { bootHost } from "./real-server.ts";

/**
 * Acceptance 4e: after competing replacement hosts the settled host had no `.context`, so the
 * owner's `pea` lost its human principal. Only the host that holds the service claim writes the
 * terminal context; a host whose claim is refused never touches the claim holder's file.
 */
test("a host whose service claim is refused leaves the claim holder's terminal context", async () => {
  const settled = await bootHost();
  try {
    const path = hostContextTokenPath(hostOwnership.serviceName);
    expect(readFileSync(path, "utf8")).toBe(settled.terminal);
    const rival = await Effect.runPromiseExit(
      Effect.scoped(
        Layer.launch(
          makeHttpLive({
            capabilities: { revit: true },
            port: 0,
            lifecycle: {
              latch: Effect.runSync(Deferred.make<void>()),
              handle: Effect.runSync(Deferred.make<ServiceHostHandle>()),
            },
            webRoot: null,
          }),
        ),
      ),
    );
    expect(Exit.isFailure(rival)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(settled.terminal);
    expect(callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: settled.terminal })).toEqual({
      caller: { kind: "human", via: "cli" },
    });
  } finally {
    await settled.close();
  }
}, 30_000);

test("the claim holder removes its terminal context when the claim releases", async () => {
  const host = await bootHost();
  const path = hostContextTokenPath(hostOwnership.serviceName);
  expect(existsSync(path)).toBe(true);
  await host.close();
  expect(existsSync(path)).toBe(false);
}, 30_000);
