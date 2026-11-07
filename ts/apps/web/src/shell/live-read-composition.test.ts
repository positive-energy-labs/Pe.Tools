import { Context, Effect, Layer, Schema, Option } from "effect";
import { expect, test, vi } from "vite-plus/test";
import {
  HostNativeRead,
  canonicalJson,
} from "../../../../packages/host-internal/src/native-read.ts";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../../packages/host-contracts/src/fixtures/k2-roster.json" with { type: "json" };
import { hostOwnership } from "../../../host/src/host-ownership.ts";
import { HostDocumentMarks } from "../../../host/src/document-marks.ts";
import { HostSessionInventory } from "../../../host/src/session-inventory.ts";
import { DuctFiles } from "../../../host/src/ducts-files.ts";
import { RevitBridge } from "../../../host/src/bridge.ts";
import { SdkSession } from "../../../host/src/sdk-session.ts";
import { bootHost } from "../../../host/tests/real-server.ts";
import { connectTestBridge } from "../../../host/tests/bridge-fixture.ts";
import { hostInputs } from "../../../host/src/host-program.ts";
import { admittedReceiptStamps } from "../../../host/src/receipt-export.ts";
import { fansSheetCapability, type ResolvedRead } from "@pe/agent-contracts";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { sourceRouteServices } from "./source-route-services.ts";
import { hostRead } from "../route/host-read.ts";
import { watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { firmFilePath, FIRM_SEED } from "../../../host/src/ducts-inputs.ts";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../host/runtime", () => ({ hostFetch: transport.fetch }));
// This falsifier concerns concurrent Value responses. No EventSource implementation runs in Node.
vi.mock("../readings", () => ({ openEventSource: () => ({ close() {} }) }));

// Forward the services already owned by makeHttpLive; optional lookup keeps these test layers closed.
const ambient = <S, I>(tag: Context.Key<S, I>) =>
  Layer.effect(tag, Effect.serviceOption(tag).pipe(Effect.map(Option.getOrThrow)));

async function liveHost(record = false, duringNative?: (root: string) => Promise<void>) {
  let target!: { session: string; openId: string };
  const inputRoot = dirname(dirname(firmFilePath()));
  const roster = nativeResponseSchema("ducts.snapshot.roster").parse(rosterCapture);
  const inputs = record
    ? await Effect.runPromise(
        hostInputs(admittedReceiptStamps().host, { kind: "live", capture: "automatic" }),
      )
    : undefined;
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
            target = (yield* connectTestBridge(process.pid)).target;
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
  return { ...host, target, headers, inputRoot };
}

test("source startup records a cold Fans publication through real host inputs", async () => {
  const host = await liveHost(true);
  const { target, headers } = host;
  try {
    const response = await fetch(`${host.base}/pe/fans/sheet`, {
      method: "POST",
      headers,
      body: JSON.stringify({
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
    const response = await fetch(`${host.base}/pe/fans/sheet`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
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
    const response = await fetch(`${host.base}/pe/fans/sheet`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({
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

test("mounted Fans core and roster cannot supersede one another through their shared operation", async () => {
  const host = await liveHost(true);
  const replies: unknown[] = [];
  transport.fetch.mockImplementation(async (path: string, init: RequestInit) => {
    const response = await fetch(host.base + path, {
      ...init,
      headers: { ...init.headers, ...host.headers },
    });
    if (!JSON.parse(init.body as string).release) replies.push(await response.clone().json());
    return response;
  });
  const stops: (() => void)[] = [];
  try {
    const read = hostRead(fansSheetCapability);
    const services = sourceRouteServices({ [read.key]: read.source });
    const issuer = createRouteTokenIssuer();
    const scope = issuer.scope({ target: { kind: "document", ref: host.target }, work: null });
    const open = (id: string, generation = 1) => {
      const token = issuer.attempt(scope, id, generation);
      if (!token.ok) throw Error(token.reason);
      const request = {
        key: {
          op: read.key,
          sortedKeyInput: JSON.stringify({ fan: [], sheetPath: "" }),
          freshnessGeneration: generation,
        },
      } as ResolvedRead<unknown>;
      const handle = services.reads.acquire(request, token.value);
      stops.push(
        services.readings.subscribe(request, token.value, () => {}),
        () => handle.release(),
      );
      return handle;
    };
    const handles = [open("value"), open("roster")];
    await expect
      .poll(() => handles.every((handle) => handle.read().current), { timeout: 10000 })
      .toBe(true);
    expect(
      handles.map((handle) => handle.read().current),
      JSON.stringify(replies),
    ).toEqual([true, true]);
    expect(replies).toHaveLength(1);
    expect(handles[0]!.read()).toEqual(handles[1]!.read());
    stops[0]!();
    stops[1]!(); // One pane leaves; its sibling retains the shared source.
    expect(handles[1]!.read().current).toBe(true);
    handles[0] = open("value", 2); // Explicit refresh renews the ONE publication for both readers.
    expect(handles[1]!.read().current).toBe(false);
    await expect
      .poll(() => handles.every((handle) => handle.read().current), { timeout: 10000 })
      .toBe(true);
    expect(replies).toHaveLength(2);
    expect(handles[0]!.read()).toEqual(handles[1]!.read());
    const capture = await fetch(`${host.base}/pe/history`, {
      method: "POST",
      headers: host.headers,
      body: JSON.stringify({ kind: "captured", document: "C:/model.rvt" }),
    });
    const point = await capture.json();
    expect(capture.status, JSON.stringify(point)).toBe(200);
    const replay = await fetch(`${host.base}/pe/fans/sheet`, {
      method: "POST",
      headers: {
        ...host.headers,
        "x-pe-history-point": point.id,
        "x-pe-history-page": encodeURIComponent(
          JSON.stringify({ instance: "fans.sheet", route: "fans", page: {}, href: "/fans" }),
        ),
      },
      body: JSON.stringify({
        subscription: "recorded",
        generation: 1,
        args: { target: host.target, fan: [], sheetPath: "" },
      }),
    });
    const recorded = await replay.json();
    expect(replay.status, JSON.stringify(recorded)).toBe(200);
    expect(recorded.state, JSON.stringify(recorded)).toBe("current");
  } finally {
    for (const stop of stops) stop();
    await host.close();
    transport.fetch.mockReset();
  }
});
