import { mkdtempSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";
import { readServiceFile } from "@pe/host-contracts/pe-service";
import { resolvePeaWorld } from "@pe/runtime/pea";
import { createDeterministicRuntime } from "@pe/runtime/testing";
import { makeHttpLive } from "../src/app.ts";
import { hostOwnership, productRoot } from "../src/host-ownership.ts";
import { makeMastraRuntimeLive } from "../src/mastra-runtime.ts";

// E2E-J5 over the host's real HTTP stack: Pea's web policy, the Mastra agent-controller routes the
// web client calls, and the host's own thread read. Only the model is fake; no browser, no Revit.
const call = "scenario-call-0";

async function launch(databasePath: string) {
  const nodeServer = createNodeServer();
  const appBase = productRoot();
  const previous = await readServiceFile(appBase, hostOwnership.serviceName);
  const done = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const latch = yield* Deferred.make<void>();
        const handle = yield* Deferred.make<ServiceHostHandle>();
        yield* Effect.raceFirst(
          Layer.launch(
            makeHttpLive({
              capabilities: { revit: false },
              lifecycle: { handle, latch },
              mastraLayer: makeMastraRuntimeLive({ revit: false }, undefined, async () =>
                createDeterministicRuntime({
                  databasePath,
                  resourceId: resolvePeaWorld().id,
                  peaWeb: true,
                  responses: [
                    {
                      toolCall: {
                        name: "ask_user",
                        input: {
                          question: "red or blue?",
                          options: [{ label: "red" }, { label: "blue" }],
                        },
                      },
                    },
                    { text: "fresh turn" },
                  ],
                }),
              ),
              nodeServer,
              port: 0,
              webRoot: null,
            }),
          ),
          Deferred.await(latch),
        );
      }),
    ),
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const service = await readServiceFile(appBase, hostOwnership.serviceName);
    if (service && service.token !== previous?.token) return { done, service };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("host did not start");
}

// RED, pinned with `test.fails` until the fix lands (E2E-J5 F-J5-2, cells-opus Mission 7):
// after the person pauses, the parked run has detached; `endParkedTurn` clears the session's
// suspension and aborts the session, but Mastra's agent thread registry still holds the suspended
// run warm (MASTRA_SUSPENDED_RUN_TTL_MS, 30 min) and answers the new signal `thread-blocked`, so
// the message never lands and the stored call keeps its `suspendedTools`. Flip to `test` with the fix.
test.fails("J5 over HTTP: a new turn over a parked ask is kept, and the ask reads expired after a reload", async () => {
  vi.stubEnv("PE_LANE", "dev");
  vi.stubEnv("LOCALAPPDATA", mkdtempSync(join(tmpdir(), "pe-j5-app-")));
  const { done, service } = await launch(join(mkdtempSync(join(tmpdir(), "pe-j5-db-")), "j5.db"));
  const base = `http://127.0.0.1:${service.port}`;
  const resource = encodeURIComponent(resolvePeaWorld().id);
  const thread = crypto.randomUUID();
  const session = `${base}/api/agent-controller/pea/sessions/${resource}`;
  const post = (path: string, body: unknown) =>
    fetch(`${session}/${path}?sessionScope=${thread}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const read = async () =>
    (await (await fetch(`${base}/pe/thread/${thread}`)).json()) as {
      messages: unknown[];
      expiredAsks?: { toolCallId: string }[];
      error?: string;
    };
  try {
    expect((await post("messages", { message: "ask me" })).status).toBe(200);
    await expect
      .poll(async () => JSON.stringify((await read()).messages), { timeout: 10_000 })
      .toContain(call);
    expect((await post("tool-approval", { approved: true, toolCallId: call })).status).toBe(200);
    // The ask is parked on its suspension.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect((await post("messages", { message: "never mind" })).status).toBe(200);
    await expect
      .poll(async () => JSON.stringify((await read()).messages), { timeout: 10_000 })
      .toContain("fresh turn");
    const state = await read();
    expect(JSON.stringify(state.messages)).toContain("never mind");
    expect(state.expiredAsks).toEqual([expect.objectContaining({ toolCallId: call })]);
  } finally {
    await fetch(`${base}/admin/shutdown`, {
      method: "POST",
      headers: { "x-pe-service-token": service.token },
    });
    await done;
  }
}, 60_000);
