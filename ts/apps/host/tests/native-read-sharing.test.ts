import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { fixtureNative } from "./fixture-native.ts";
import { NativeReads } from "../src/native-reads.ts";
import { settle } from "./effect-test.ts";

test("two real HTTP readers share a recorded native read; cancelling one preserves its sibling and the next read can run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-recorded-share-"));
  const native = await fixtureNative(dir, "fresh-schedule-02-revit.catalog.schedules", "driver-op.cancel");
  const socket = await native.connect();
  let reads: NativeReads["Service"] | undefined;
  const http = native.actions({}, undefined, {}, Layer.effectDiscard(Effect.map(NativeReads, value => { reads = value; })));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  native.onRequest(async key => { if (key === "revit.catalog.schedules") await held; });
  const read = (signal?: AbortSignal) => http.request(new Request("http://host/call", { method: "POST", signal,
    headers: { "content-type": "application/json", "x-pe-bridge-session-id": socket.target.session, "x-pe-open-document-id": socket.target.openId },
    body: JSON.stringify({ key: "revit.catalog.schedules", request: {} }),
  }));
  const abort = new AbortController();
  try {
    const a = read(abort.signal).catch(() => null);
    await vi.waitFor(() => expect(native.calls.map(call => call.key)).toEqual(["revit.catalog.schedules"]));
    const b = read();
    await vi.waitFor(async () => expect(await settle(reads!.retained)).toMatchObject({ entries: 1, joiners: 2 }));
    abort.abort(); release();
    expect((await b).status).toBe(200); await a;
    expect(native.calls.map(call => call.key)).toEqual(["revit.catalog.schedules"]);
    expect((await read()).status).toBe(200);
    expect(native.calls.map(call => call.key)).toEqual(["revit.catalog.schedules", "revit.catalog.schedules"]);
  } finally { release(); await native.close(); await rm(dir, { recursive: true, force: true }); }
});

test("the analysis adapter carries its actual caller through the retained Read door", async () => {
  const { withInvocationContext } = await import("@pe/runtime/context");
  const { ductsNativeRead } = await import("../src/ducts-analysis.ts");
  const { currentCaller } = await import("../src/control.ts");
  const { nativeFixture } = await import("./fans-native.fixture.ts");
  const { human, pea } = await import("./callers.ts");

  const f = await nativeFixture();
  // Substitute only HTTP transport; the existing fixture composes the real request services and bridge.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    f.request(new Request(input, init), currentCaller()),
  );
  const call = ductsNativeRead("http://fixture");
  const read = (caller: Parameters<typeof f.request>[1]) =>
    withInvocationContext({ hostBaseUrl: "http://fixture", caller }, () =>
      call("ducts.snapshot.walk", { selector: { kind: "ids", ids: [1] } }, f.target.ref),
    );
  try {
    const agent = await read(pea("analysis-fixture"));
    expect(agent.status, await agent.clone().text()).toBe(200);
    const nativeId = agent.headers.get("x-pe-native-request-id");
    expect(nativeId).toMatch(/^[0-9a-f-]{36}$/);
    const retained = await read(human);
    expect(retained.status, await retained.clone().text()).toBe(200);
    expect(retained.headers.get("x-pe-native-request-id")).toBe(nativeId);
    expect(retained.headers.get("x-pe-ducts-reused")).toBe("true");
    const anonymous = await read({ kind: "anonymous" });
    expect(anonymous.status).toBe(403);
    expect(anonymous.headers.get("x-pe-native-request-id")).toBeNull();
    expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await f.close();
  }
});
