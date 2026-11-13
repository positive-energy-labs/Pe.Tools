import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { registryService, harnessThreads, testSpawner } from "./effect-test.ts";
import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { peDo, buildCapabilities } from "@pe/mcps";
import { withInvocationContext } from "@pe/runtime/context";
import { resourceResponse, observeResources, RouteWorkspace } from "@pe/runtime";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { fixtureNative } from "./fixture-native.ts";
import { approvedPea } from "./callers.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProviders } from "../src/harness/providers.ts";
import { HostLog } from "../src/host-log.ts";
import { pointerThread, threadPointerPort } from "../src/thread-pointers.ts";
import { human, actAs } from "./callers.ts";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-pointers-"));
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
});
afterAll(async () => {
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  await rm(root, { recursive: true, force: true });
});
const open = () =>
  harnessThreads({
    runs: registryService(),
    root: stateFixture(join(root, "threads")),
    log: new HostLog(stateFixture(join(root, "log")), Date.now),
    worldRoot: tmpdir(),
    mcpServer: () => ({ name: "pea", command: "unused", args: [], env: [] }),
    providers: createProviders({ spawner: testSpawner(), shellPath: async () => "", probeOnStart: false }),
  });

// Mutant: classify pointers.point as a raw Read again. The real /call refuses it with 409.
test("Pea points at a families type through the action door and the next head stream frame carries it", async () => {
  const threads = await open();
  const native = await fixtureNative(join(root, "point-door"));
  const abort = new AbortController();
  try {
    const created = await actAs(human, () => threads.fetch(new Request("http://host/pe/threads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "claude" }),
    })));
    const { id } = await created.json() as { id: string };
    const caller = approvedPea(id);
    const door = native.actions({}, undefined, { pointers: threads.pointers });
    const stream = resourceResponse(new Request(`http://host/pe/resources?keys=${encodeURIComponent(JSON.stringify([
      { kind: "thread-head", thread: id },
    ]))}`, { signal: abort.signal }), observeResources(new RouteWorkspace({
      registrations: [], store: fileRouteDocumentStore(stateFixture(join(root, "pointer-work"))),
    }), threads.heads));
    const reader = stream.body!.getReader();
    let buffer = "";
    const next = async (): Promise<unknown> => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (data) return JSON.parse(data);
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw Error("Pointer stream ended");
        buffer += new TextDecoder().decode(chunk.value);
      }
    };
    expect(await next()).toMatchObject({ value: { pointers: [] } });
    const requests: { path: string; status: number }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/pe/capabilities") return Response.json({
        at: new Date().toISOString(), machine: machineFixture([]), sources: {}, diagnostics: [],
        capabilities: buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }),
      });
      if (path === "/ops") return Response.json({ operations: tsOnlyOperationCatalog });
      if (path === "/pe/scope/self") return actAs(caller, () => threads.fetch(request));
      const response = await door.request(request, caller);
      requests.push({ path, status: response.status });
      return response;
    });
    const run = (key: string, input: object, toolCallId: string) => withInvocationContext({
      caller, hostBaseUrl: "http://point.test",
    }, () => peDo.execute(peDo.inputSchema.parse({ key, input, timeoutSeconds: 30 }), { agent: { toolCallId } }));
    const result = await run("op:pointers.point", {
      route: "families", target: subjectCode({ keyKind: "name", key: ["Price LBP15A Return", "8 X 4 D"] }), label: "Return type",
    }, "point");
    expect(result, JSON.stringify({ result, requests })).toMatchObject({ ok: true });
    expect(requests).toContainEqual({ path: "/actions", status: 200 });
    expect(requests.some(request => request.path === "/call")).toBe(false);
    expect(await next()).toMatchObject({ value: { pointers: [expect.objectContaining({ route: "families", label: "Return type" })] } });
    const [pointer] = threads.pointers.read(id).pointers;
    expect(pointer).toBeDefined();
    expect(await run("op:pointers.dismiss", { id: pointer!.id }, "dismiss")).toMatchObject({ ok: true });
    expect(await next()).toMatchObject({ value: { pointers: [] } });
    const raw = await door.request(new Request("http://host/call", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "pointers.point", request: { route: "families", target: pointer!.target, label: "retired" } }),
    }), caller);
    expect(raw.status).toBe(409);
    expect(await raw.text()).toContain("raw mutation dispatch is retired");
  } finally {
    abort.abort();
    vi.unstubAllGlobals();
    await native.close();
    await threads.close();
  }
});

test("standalone heads stream empty pointers without admitting pointer mutations", async () => {
  const threads = await open();
  const frames: unknown[] = [];
  const stop = threads.heads.observe("standalone", frame => frames.push(frame.value));
  try {
    await Promise.resolve();
    expect(frames).toEqual([{ targets: [], revision: 0, pointers: [] }]);
    const response = await actAs(human, () => threads.fetch(new Request("http://host/pe/scope/standalone", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: [], expectedRevision: 0 }),
    })));
    expect(response.status).toBe(200);
    expect(frames.at(-1)).toEqual({ targets: [], revision: 1, pointers: [] });
    expect(() => threads.pointers.read("standalone")).toThrow("Unknown thread");
    expect(() => threads.pointers.point("standalone", {
      route: "fans", target: {}, label: "missing",
    })).toThrow("Unknown thread");
    expect(() => threads.pointers.dismiss("standalone", "missing")).toThrow("Unknown thread");
  } finally {
    stop();
    await threads.close();
  }
});

test("a pointer lives in thread meta: it survives a host reload and leaves only by dismissal", async () => {
  const first = await open();
  const created = await actAs(human, () =>
    first.fetch(
      new Request("http://host/pe/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "claude" }),
      }),
    ),
  );
  const id = ((await created.json()) as { id: string }).id;
  const heads: unknown[] = [];
  const stop = first.heads.observe(id, frame => heads.push(frame.value.pointers));
  await Promise.resolve();
  expect(heads).toEqual([[]]);
  // The call route reaches thread meta only through the injected port.
  const port = threadPointerPort();
  expect(() => port.read(id)).toThrow(/unavailable/);
  port.bind(first.pointers);
  const pea = { kind: "pea", thread: id } as never;
  port.point(pointerThread(pea, "another-thread"), {
    route: "fans",
    target: { selected: '["UniqueId:u-7"]' },
    label: "FC-1 fan flow",
  });
  expect(heads.at(-1)).toEqual([expect.objectContaining({ label: "FC-1 fan flow" })]);
  stop();
  await first.close();

  const second = await open();
  port.bind(second.pointers);
  const [pointer] = port.read(pointerThread({ kind: "human" } as never, id)).pointers;
  expect(pointer).toMatchObject({ route: "fans", label: "FC-1 fan flow", target: { selected: '["UniqueId:u-7"]' } });
  const dismissed: unknown[] = [];
  const release = second.heads.observe(id, frame => dismissed.push(frame.value.pointers));
  await Promise.resolve();
  port.dismiss(id, pointer!.id);
  expect(dismissed.at(-1)).toEqual([]);
  release();
  await second.close();

  const third = await open();
  expect(third.pointers.read(id).pointers).toEqual([]);
  await third.close();
  expect(() => pointerThread({ kind: "human" } as never, undefined)).toThrow(/thread/);
  expect(() => pointerThread({ kind: "anonymous" } as never, id)).toThrow();
});
