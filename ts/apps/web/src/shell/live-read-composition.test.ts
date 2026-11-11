import { Context, Effect, Fiber, Layer, Schema, Option } from "effect";
import { expect, test, vi } from "vite-plus/test";
import {
  HostNativeRead,
  canonicalJson,
} from "../../../../packages/host-internal/src/native-read.ts";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../../packages/host-contracts/src/fixtures/k2-roster.json";
import { hostOwnership } from "../../../host/src/host-ownership.ts";
import { HostDocumentMarks } from "../../../host/src/document-marks.ts";
import { HostSessionInventory } from "../../../host/src/session-inventory.ts";
import { DuctFiles } from "../../../host/src/ducts-files.ts";
import { Publications } from "../../../host/src/reads/evaluator.ts";
import { RevitBridge } from "../../../host/src/bridge.ts";
import { SdkSession } from "../../../host/src/sdk-session.ts";
import { bootHost } from "../../../host/tests/real-server.ts";
import { connectTestBridge } from "../../../host/tests/bridge-fixture.ts";
import { hostInputs } from "../../../host/src/host-program.ts";
import { admittedReceiptStamps } from "../../../host/src/receipt-export.ts";
import { watch } from "node:fs";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { HostInputContext } from "../../../host/src/input-context.ts";
import { openRecordingWriter } from "../../../host/src/native-recording.ts";
import { dirname, join } from "node:path";
import { firmFilePath, FIRM_SEED } from "../../../host/src/ducts-inputs.ts";

// Forward the services already owned by makeHttpLive; optional lookup keeps these test layers closed.
const ambient = <S, I>(tag: Context.Key<S, I>) =>
  Layer.effect(tag, Effect.serviceOption(tag).pipe(Effect.map(Option.getOrThrow)));

async function liveHost(
  record = false,
  duringNative?: (root: string) => Promise<void>,
  isolated?: HostInputContext["Service"],
) {
  let target!: { session: string; openId: string };
  let disconnectBridge: () => Promise<void> = async () => {
    throw Error("Test bridge has not connected");
  };
  // The firm file is a shared setting (ADR 0035 rule 11): give this host a shared root to watch.
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", await mkdtemp(join(tmpdir(), "pe-shared-")));
  const inputRoot = dirname(dirname(firmFilePath()!));
  const roster = nativeResponseSchema("ducts.snapshot.roster").parse(rosterCapture);
  const inputs =
    isolated ??
    (record
      ? await Effect.runPromise(
          hostInputs(admittedReceiptStamps().host, { kind: "live", capture: "automatic" }),
        )
      : undefined);
  const host = await bootHost({
    inputs,
    reads: {
      live: {
        marks: ambient(HostDocumentMarks),
        inventory: HostSessionInventory.layer.pipe(
          Layer.provide(Layer.mergeAll(ambient(RevitBridge), ambient(SdkSession))),
        ),
        files: DuctFiles.layer(),
        native: Layer.effect(
          HostNativeRead,
          Effect.gen(function* () {
            const connected = yield* connectTestBridge(process.pid);
            target = connected.target;
            disconnectBridge = () => Effect.runPromise(Fiber.interrupt(connected.connection));
            const actualTarget = {
              processIncarnation: { pid: process.pid, startedAt: 1000 },
              openDocumentLifetime: { openId: target.openId },
            };
            return {
              resolve: (input) =>
                Effect.succeed({
                  ...actualTarget,
                  operationKey: input.key,
                  normalizedInput: canonicalJson(
                    Schema.decodeUnknownSync(Schema.Json)(input.input),
                  ),
                  freshnessGeneration: "g1",
                  representation: "overview",
                }),
              read: (input) =>
                Effect.promise(async () => {
                  await duringNative?.(inputRoot);
                  return {
                    value: Schema.decodeUnknownSync(Schema.Json)(roster),
                    nativeRequestId: input.key,
                    actualTarget,
                    freshness: { freshnessGeneration: "g1" },
                    cost: {},
                    outcome: "committed" as const,
                  };
                }),
            };
          }),
        ).pipe(Layer.provide(ambient(RevitBridge))),
      },
    },
  });
  const headers = {
    "content-type": "application/json",
    "x-pe-context": host.terminal,
    [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
  };
  return {
    ...host,
    target,
    headers,
    inputRoot,
    inputs,
    disconnectBridge: () => disconnectBridge(),
  };
}

test("source startup records a cold Fans publication through real host inputs", async () => {
  const host = await liveHost(true);
  const { target, headers } = host;
  try {
    const response = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "cold-fans",
        generation: 0,
        args: { target, fan: [], sheetPath: "" },
      }),
    });
    const publication = await response.json();
    expect(response.status, JSON.stringify(publication)).toBe(200);
    expect(publication.state, JSON.stringify(publication)).toBe("current");
    expect(publication.value.data.rows.length).toBeGreaterThan(0);
    const history = await fetch(
      `${host.base}/pe/history?document=${encodeURIComponent("C:/model.rvt")}`,
      { headers },
    );
    expect(history.status, await history.clone().text()).toBe(200);
    expect((await history.json()).points).toHaveLength(1);
  } finally {
    await host.close();
  }
});

test("an empty ancestor directory cannot invalidate the missing firm input mid-read", async () => {
  const host = await liveHost(true, async (root) => {
    const observed = Promise.withResolvers<void>();
    const watcher = watch(root, { recursive: true }, () => observed.resolve());
    const timeout = setTimeout(
      () => observed.reject(Error("No real filesystem metadata event")),
      5000,
    );
    try {
      await mkdir(join(root, "Firm"));
      await observed.promise;
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      watcher.close();
      clearTimeout(timeout);
    }
  });
  try {
    const response = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "metadata",
        generation: 1,
        args: { target: host.target, fan: [], sheetPath: "" },
      }),
    });
    const result = await response.json();
    expect(result.state, JSON.stringify(result)).toBe("current");
    const events = await fetch(`${host.base}/pe/read-events?subscription=metadata&generation=1`, {
      headers: host.headers,
      signal: AbortSignal.timeout(10000),
    });
    const reader = events.body!.getReader();
    let received = "";
    const until = async (state: string) => {
      while (!received.includes(`"state":"${state}"`)) {
        const chunk = await reader.read();
        if (chunk.done) throw Error(`SSE closed before ${state}`);
        received += new TextDecoder().decode(chunk.value);
      }
    };
    try {
      await until("current");
      await writeFile(
        join(host.inputRoot, "Firm", "ducts.json"),
        JSON.stringify({ ...FIRM_SEED, version: "changed" }),
      );
      await until("refresh-needed");
    } finally {
      await reader.cancel();
    }
  } finally {
    await host.close();
  }
});

test("release fences its own attempt without consuming the next generation's changed args", async () => {
  const host = await liveHost();
  const send = async (generation: number, sheetPath: string, release = false) => {
    const response = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "changing-args",
        generation,
        release,
        args: { target: host.target, fan: [], sheetPath },
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  try {
    expect((await send(1, "")).state).toBe("current");
    await send(1, "", true);
    expect((await send(1, "")).state).toBe("superseded");
    const next = await send(2, "new path");
    expect(next.state, JSON.stringify(next)).toBe("current");
  } finally {
    await host.close();
  }
});

test("a captured Fans publication reopens through real host history", async () => {
  const host = await liveHost(true);
  try {
    const response = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "capturing",
        generation: 1,
        args: { target: host.target, fan: [], sheetPath: "" },
      }),
    });
    const publication = await response.json();
    expect(response.status, JSON.stringify(publication)).toBe(200);
    expect(publication.state, JSON.stringify(publication)).toBe("current");
    const capture = await fetch(`${host.base}/pe/history`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({ kind: "captured", document: "C:/model.rvt" }),
    });
    const point = await capture.json();
    expect(capture.status, JSON.stringify(point)).toBe(200);
    const replay = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: {
        ...host.headers,
        "x-pe-history-point": point.id,
        "x-pe-history-page": encodeURIComponent(
          JSON.stringify({ instance: "fans.sheet", route: "fans", page: {}, href: "/fans" }),
        ),
      },
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "recorded",
        generation: 1,
        args: { target: host.target, fan: [], sheetPath: "" },
      }),
    });
    const recorded = await replay.json();
    expect(replay.status, JSON.stringify(recorded)).toBe(200);
    expect(recorded.state, JSON.stringify(recorded)).toBe("current");
  } finally {
    await host.close();
  }
});

test("a stopped recording preserves live Fans but cannot hide a late closed target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-capture-stop-"));
  const automatic = await Effect.runPromise(
    hostInputs(admittedReceiptStamps().host, { kind: "live", capture: "automatic" }),
  );
  if (automatic.lane.kind !== "live" || !automatic.lane.captureStore)
    throw Error("Expected an automatic recording");
  const writer = await Effect.runPromise(
    openRecordingWriter(dir, automatic.lane.captureStore.identity, {
      maxBytes: 256 * 1024 * 1024,
      maxTakings: 10000,
    }),
  );
  const inputs = await Effect.runPromise(
    HostInputContext.pipe(
      Effect.provide(HostInputContext.layer({ kind: "live", captureStore: writer })),
    ),
  );
  const host = await liveHost(false, undefined, inputs);
  const publish = () =>
    fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
        read: "fans.sheet",
        subscription: "capture-stop",
        generation: 0,
        args: { target: host.target, fan: [], sheetPath: "" },
      }),
    });
  try {
    const initial = await publish();
    expect(initial.status, await initial.clone().text()).toBe(200);
    const historyBefore = await fetch(
      `${host.base}/pe/history?document=${encodeURIComponent("C:/model.rvt")}`,
      { headers: host.headers },
    );
    expect((await historyBefore.json()).points).toHaveLength(1);
    const writer = host.inputs?.lane.kind === "live" ? host.inputs.lane.captureStore : undefined;
    expect(writer).toBeTruthy();
    await Effect.runPromise(
      writer!.capture.stop(writer!.capture.begin()!, "unsupported", {
        site: "builtin",
        op: "test.capture",
      }),
    );
    const response = await publish();
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).state).toBe("current");
    const history = await fetch(
      `${host.base}/pe/history?document=${encodeURIComponent("C:/model.rvt")}`,
      { headers: host.headers },
    );
    const body = await history.json();
    expect(body.points).toHaveLength(1);
    expect(body.problem).toBe(
      `History stopped at ${new Date(writer!.capture.truncated()!.stoppedAt).toISOString()}: unsupported`,
    );
    const original = Publications.prototype.publish;
    const lateClose = vi
      .spyOn(Publications.prototype, "publish")
      .mockImplementationOnce(
        function (this: Publications, id, generation, definition, args, port, keep) {
          return original.bind(this)(
            id,
            generation,
            definition,
            args,
            port,
            keep &&
              (async (publication) => {
                await host.disconnectBridge(); // After real evaluation, before the real publication callback.
                return keep(publication);
              }),
          );
        },
      );
    try {
      const refused = await publish();
      const value = await refused.json();
      expect(value.state, JSON.stringify(value)).toBe("refresh-needed");
      expect(value.reason).toMatch(/no longer open/);
    } finally {
      lateClose.mockRestore();
    }
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
