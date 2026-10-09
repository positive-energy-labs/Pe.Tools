import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Context, Deferred, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test } from "vite-plus/test";
import type { UpdatePlan } from "@pe/host-contracts/pe-revit-contract";
import type { ServiceHostHandle } from "@pe/host-contracts/pe-service-host";

test("update consent carries the checked plan id into typed apply and returns its durable receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-update-contract-"));
  const output = join(dir, "envelope.json");
  const calls = join(dir, "argv.jsonl");
  const preload = join(dir, "sdk.mjs");
  await writeFile(
    preload,
    `
    import { appendFileSync, readFileSync } from 'node:fs';
    import { basename } from 'node:path';
    appendFileSync(process.env.PE_TEST_UPDATE_ARGS, JSON.stringify([basename(process.argv[1]), ...process.argv.slice(2)]) + '\\n');
    process.stdout.write(readFileSync(process.env.PE_TEST_UPDATE_OUTPUT));
    process.exit(0);
  `,
  );
  const env = {
    PE_LANE: "installed",
    LOCALAPPDATA: dir,
    PE_REVIT_CMD: process.execPath,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    PE_TEST_UPDATE_ARGS: calls,
    PE_TEST_UPDATE_OUTPUT: output,
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const installed = join(dir, "Positive Energy", "Pe.Tools");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "product.payloads.json"), JSON.stringify({ version: "0.7.0" }));
  const envelope = (result: unknown, exitCode = 0, diagnostics: unknown[] = []) =>
    writeFile(
      output,
      JSON.stringify({
        result,
        exitCode,
        diagnostics,
        resolved: null,
        binary: {},
        command: {},
        nextSteps: [],
        guide: "update",
        related: [],
      }),
    );
  const plan: UpdatePlan = {
    planId: "checked-plan",
    observedAtUtc: "2026-10-09T00:00:00Z",
    product: "Pe.Tools",
    current: "0.7.0",
    latest: "0.8.0",
    available: true,
    feed: "test-feed",
    msi: null,
    quiet: true,
    revits: [],
    blockers: [],
    effects: { close: [], reopen: [], restartYears: [] },
  };
  const { HostLifecycle } = await import("../src/host-lifecycle.ts");
  const { updateRoutes } = await import("../src/update-route.ts");
  const lifecycle = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        latch: yield* Deferred.make<void>(),
        handle: yield* Deferred.make<ServiceHostHandle>(),
      };
    }),
  );
  const web = HttpRouter.toWebHandler(
    updateRoutes.pipe(Layer.provideMerge(Layer.succeed(HostLifecycle, lifecycle))),
    { disableLogger: true },
  );
  const post = (body: unknown) =>
    web.handler(
      new Request("http://host/host/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      Context.empty() as never,
    );
  try {
    await envelope(plan);
    const read = await web.handler(
      new Request("http://host/host/update"),
      Context.empty() as never,
    );
    expect(await read.json()).toMatchObject({
      planId: plan.planId,
      quiet: true,
      updateAvailable: true,
    });
    expect((await post({})).status).toBe(400);
    await envelope(
      {
        state: "running",
        planId: plan.planId,
        requestId: "apply-request",
        receiptPath: "receipt.json",
        legs: [{ name: "handoff", status: "ok" }],
      },
      4,
    );
    expect(await (await post({ planId: plan.planId })).json()).toMatchObject({
      accepted: true,
      planId: plan.planId,
      requestId: "apply-request",
      receiptPath: "receipt.json",
    });
    await envelope({}, 3, [{ code: "update.plan-stale", detail: "effects changed" }]);
    const stale = await post({ planId: plan.planId });
    expect(stale.status).toBe(502);
    expect(await stale.json()).toMatchObject({ error: "update.plan-stale: effects changed" });
    expect(
      (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      ["update", "check", "--json"],
      ["update", "apply", plan.planId, "--wait-pid", String(process.pid), "--json"],
      ["update", "apply", plan.planId, "--wait-pid", String(process.pid), "--json"],
    ]);
  } finally {
    await web.dispose();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
