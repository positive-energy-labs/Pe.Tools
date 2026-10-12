import { afterAll, afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessEvent, HarnessThreadBody, Provider, ThreadHead } from "@pe/agent-contracts";
import { createProviders } from "../src/harness/providers.ts";
import { createHarnessThreads, IDLE_CHILD_MS, WAITING_MS } from "../src/harness/threads.ts";
import * as adapter from "../src/harness/adapter.ts";
import { peaCodexProjectConfig, userCodexMcpServers } from "../src/harness/user-shell.ts";
import { productProvidersPath } from "../src/product-paths.ts";
import { createUpdateReader, type UpdateRunner } from "../src/update-reader.ts";
import type { Envelope } from "@pe/host-contracts/pe-revit-contract";

let root = "";
let previousLocalAppData: string | undefined;
type Host = {
  fetch: (request: Request) => Promise<Response>;
  heads: ReturnType<typeof createHarnessThreads>["heads"];
  close: () => Promise<unknown>;
  consoles: string[];
};
const hosts: Host[] = [];
const mcpServer = () => ({ name: "pea", command: "unused", args: [], env: [] });
/** Threads and providers behind one fetch, as the host's router mounts them. No probe at start. */
const host = (updatePending?: () => boolean): Host => {
  const consoles: string[] = [];
  const providers = createProviders({
    shellPath: async () => "C:\\canary-bin;C:\\also",
    probeOnStart: false,
    openConsole: async (command) => void consoles.push(command),
  });
  const threads = createHarnessThreads({
    updatePending,
    root,
    worldRoot: tmpdir(),
    mcpServer,
    developerInstructions: async () => "KERNEL: You are Pea.",
    providers,
  });
  const routed: Host = {
    fetch: (request) =>
      /^\/pe\/(providers|access)/.test(new URL(request.url).pathname)
        ? providers.fetch(request)
        : threads.fetch(request),
    heads: threads.heads,
    close: threads.close,
    consoles,
  };
  hosts.push(routed);
  return routed;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-harness-"));
  // Providers and access resolve under this root, never the user's.
  previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
  process.env.PE_HARNESS_ADAPTER_CODEX = process.env.PE_HARNESS_ADAPTER_CLAUDE;
});
afterEach(() => {
  delete process.env.FAKE_ACP_SHAPE;
  delete process.env.FAKE_ACP_AUTH;
  delete process.env.FAKE_ACP_GATE;
  delete process.env.FAKE_ACP_NATIVE_CURRENT;
  vi.useRealTimers();
});
afterAll(async () => {
  await Promise.all(hosts.map((threads) => threads.close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  delete process.env.PE_HARNESS_ADAPTER_CODEX;
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  await rm(root, { recursive: true, force: true });
});

const caller = (threads: Host) => async (method: string, path: string, body?: unknown) => {
  const response = await threads.fetch(
    new Request(`http://host${path}`, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    }),
  );
  return { status: response.status, json: await response.json().catch(() => null) };
};
/** A request with no body and so no content type, as a browser `fetch(url, { method })` sends. */
const bare = (threads: Host, method: string, path: string) =>
  threads.fetch(new Request(`http://host${path}`, { method }));
const reader = (threads: Host) => async (id: string) =>
  (await caller(threads)("GET", `/pe/threads/${id}`)).json as HarnessThreadBody;
async function until(
  read: (id: string) => Promise<HarnessThreadBody>,
  id: string,
  done: (body: HarnessThreadBody) => boolean,
) {
  for (let i = 0; i < 200; i++) {
    const body = await read(id);
    if (done(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out: ${JSON.stringify(await read(id))}`);
}
const kinds = (events: HarnessEvent[]) =>
  events.map((e) => (e.kind === "update" ? `update:${e.update.sessionUpdate}` : e.kind));

test("automatic update admission refuses a new Pea prompt through download and releases on confirmed refusal", async () => {
  const planId = "64f25f46-dfa6-4ee6-b973-d7f6a8b523c4";
  let release!: () => void;
  const download = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requestId = "";
  let state = "running";
  const receipt = () => ({
    state,
    requestId,
    planId,
    receiptPath: "fixture.receipt.json",
    reopen: [],
    restartYears: [],
    legs: [],
  });
  const answer = (result: unknown): Envelope<unknown> => ({
    result,
    exitCode: state === "running" ? 4 : 3,
    diagnostics: [],
    resolved: null,
    binary: {} as Envelope<unknown>["binary"],
    command: {} as Envelope<unknown>["command"],
    nextSteps: [],
    guide: "update",
    related: [],
  });
  const run: UpdateRunner = async (args) => {
    if (args[0] === "update") {
      requestId = args[args.indexOf("--request-id") + 1]!;
      await download;
      return answer(receipt());
    }
    return answer({ requestId, response: { requestId, key: "update.apply", result: receipt() } });
  };
  const updates = createUpdateReader({
    path: join(root, "auto-update.json"),
    run,
    installed: true,
    pid: 123,
  });
  const threads = host(updates.automaticPending);
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (body) => body.events.some((event) => event.kind === "session"));
  const applying = updates.apply(planId, true);
  try {
    expect(updates.automaticPending()).toBe(true);
    const refused = await call("POST", `/pe/threads/${id}/prompt`, {
      text: "new turn during download",
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain("updating");
    expect((await read(id)).events.some((e) => e.kind === "prompt" || e.kind === "queued")).toBe(
      false,
    );
    release();
    await applying;
    expect(updates.automaticPending()).toBe(true);
    state = "refused";
    await updates.refresh(false);
    expect(updates.automaticPending()).toBe(false);
    expect((await call("POST", `/pe/threads/${id}/prompt`, { text: "after refusal" })).status).toBe(
      200,
    );
    await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
  } finally {
    release();
    await applying;
    await threads.close();
  }
});
const turnEnds = (body: HarnessThreadBody) => body.events.filter((e) => e.kind === "turn_end");
/** The open asks: `permission_request`s with no `permission_resolved`. */
const openAsks = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "permission_request" &&
    !body.events.some((r) => r.kind === "permission_resolved" && r.requestId === e.requestId)
      ? [e]
      : [],
  );
const openQuestions = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "question_request" &&
    !body.events.some((r) => r.kind === "question_resolved" && r.requestId === e.requestId)
      ? [e]
      : [],
  );
/** What the fake echoed for the last prompt: the text the harness actually received. */
const lastEcho = (body: HarnessThreadBody) => {
  const prompt = body.events.findLastIndex((e) => e.kind === "prompt");
  const chunk = body.events
    .slice(prompt)
    .find((e) => e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk");
  return chunk?.kind === "update"
    ? ((chunk.update as { content?: { text?: string } }).content?.text ?? "")
    : "";
};

/** Real pipe progress while only the host's timeout clock is fake. */
async function untilIo<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const end = performance.now() + 5000;
  while (performance.now() < end) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out: ${JSON.stringify(await read())}`);
}

test("idle reaping keeps history and choices, and a prompt waits for exact-child retirement", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await untilIo(
    () => read(id),
    (b) => b.models.length > 0,
  );
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/trait`, { id: "effort", value: "high" });
  await call("POST", `/pe/threads/${id}/trait`, { id: "fast", value: true });
  await call("POST", `/pe/threads/${id}/prompt`, { text: "pid" });
  const before = await untilIo(
    () => read(id),
    (b) => !b.running && turnEnds(b).length === 1,
  );
  const pid = Number(
    before.events
      .flatMap((e) =>
        e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk"
          ? [(e.update.content as { text?: string })?.text ?? ""]
          : [],
      )
      .find((text) => text.startsWith("PID="))
      ?.slice(4),
  );
  expect(Number.isInteger(pid)).toBe(true);
  expect(pid).toBeGreaterThan(0);
  const realStop = adapter.stopChild;
  let release!: () => void;
  const stop = vi.spyOn(adapter, "stopChild").mockImplementationOnce(async (child) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await realStop(child);
  });
  const stream = await threads.fetch(new Request(`http://host/pe/threads/${id}/stream`));
  try {
    await vi.advanceTimersByTimeAsync(IDLE_CHILD_MS - 1);
    expect((await read(id)).session).toBe("started");
    await call("GET", "/pe/threads");
    await read(id);
    await vi.advanceTimersByTimeAsync(1);
    expect((await read(id)).session).toBe("closed");
    expect((await read(id)).events).toEqual(before.events);
    expect(JSON.parse(await readFile(join(root, id, "meta.json"), "utf8")).modelId).toBe("m2");
    expect((await call("GET", "/pe/threads")).json.some((t: { id: string }) => t.id === id)).toBe(
      true,
    );
    await call("POST", `/pe/threads/${id}/prompt`, { text: "after idle" });
    expect((await read(id)).session).toBe("closed");
    expect((await read(id)).running).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    release();
    const resumed = await untilIo(
      () => read(id),
      (b) => b.session === "resumed" && !b.running,
    );
    expect(resumed.modelId).toBe("m2");
    expect(resumed.traits.map((trait) => trait.current)).toEqual(["high", true]);
    expect(resumed.events.slice(0, before.events.length)).toEqual(before.events);
    expect(resumed.events.filter((e) => e.kind === "error")).toEqual([]);
    expect(lastEcho(resumed)).toBe("echo: after idle");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    release?.();
    stop.mockRestore();
    await stream.body?.cancel();
    await threads.close();
  }
});

test("connect, model/trait RPCs, active turns, queued work and asks prevent idle reaping", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const gates = await mkdtemp(join(root, "gates-"));
  process.env.FAKE_ACP_GATE = gates;
  await writeFile(join(gates, "connect"), "hold");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  try {
    await untilIo(async () => existsSync(join(gates, "connect.active")), Boolean);
    await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
    expect((await read(id)).session).toBe("started");
    await rm(join(gates, "connect"));
    await untilIo(
      () => read(id),
      (b) => b.models.length > 0,
    );
    for (const [verb, input] of [
      ["model", { modelId: "m2" }],
      ["trait", { id: "effort", value: "high" }],
    ] as const) {
      await rm(join(gates, "config.active"), { force: true });
      await writeFile(join(gates, "config"), "hold");
      const changed = call("POST", `/pe/threads/${id}/${verb}`, input);
      await untilIo(async () => existsSync(join(gates, "config.active")), Boolean);
      await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
      expect((await read(id)).session).toBe("started");
      await rm(join(gates, "config"));
      expect((await changed).status).toBe(200);
    }
    for (const prompt of ["hang", "permission", "question"]) {
      await call("POST", `/pe/threads/${id}/prompt`, { text: prompt });
      await untilIo(
        () => read(id),
        (b) =>
          prompt === "permission"
            ? openAsks(b).length > 0
            : prompt === "question"
              ? openQuestions(b).length > 0
              : lastEcho(b) === "echo: hang",
      );
      const queued = await call("POST", `/pe/threads/${id}/prompt`, { text: "queued" });
      expect(queued.status).toBe(202);
      await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
      const active = await read(id);
      expect(active.session).toBe("started");
      expect(active.running).toBe(true);
      expect(active.queued).toHaveLength(1);
      await call("POST", `/pe/threads/${id}/cancel`);
      await untilIo(
        () => read(id),
        (b) => !b.running && b.queued.length === 0,
      );
    }
  } finally {
    await rm(gates, { recursive: true, force: true });
    await threads.close();
  }
});

test("a thread prompts, parks a permission, cancels, queues, renames, and replays over SSE", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id = created.json.id as string;
  const started = await until(read, id, (b) => b.session === "started" && b.models.length > 0);
  expect(started.models.map((m) => m.modelId)).toEqual(["m1", "m2"]);
  expect([started.modelId, started.lastSeq]).toEqual(["m1", 1]);
  expect([started.providerId, started.providerName]).toEqual(["claude", "Claude Code"]);
  // Traits are the config options beyond model and mode, normalized.
  expect(started.traits).toEqual([
    {
      id: "effort",
      name: "Effort",
      kind: "select",
      options: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
      current: "low",
    },
    { id: "fast", name: "Fast", kind: "boolean", current: false },
  ]);

  // Prompt -> echo + tool_call -> turn_end.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "hello" });
  let body = await until(read, id, (b) => turnEnds(b).length === 1);
  expect(kinds(body.events)).toEqual([
    "session",
    "prompt",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  expect(body.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(body.lastSeq).toBe(5);

  // Permission parks the turn until answered.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "ask permission" });
  body = await until(read, id, (b) => openAsks(b).length === 1);
  expect(body.running).toBe(true);
  const ask = openAsks(body)[0]!;
  expect(ask.toolCall).toMatchObject({ toolCallId: "t-ask permission", title: "fake tool" });
  expect(
    (await call("POST", `/pe/threads/${id}/permission`, { requestId: "nope", optionId: "yes" }))
      .status,
  ).toBe(409);
  await call("POST", `/pe/threads/${id}/permission`, {
    requestId: ask.requestId,
    optionId: "yes",
  });
  body = await until(read, id, (b) => turnEnds(b).length === 2);
  expect(kinds(body.events).slice(5)).toEqual([
    "prompt",
    "update:agent_message_chunk",
    "update:tool_call",
    "permission_request",
    "permission_resolved",
    "update:agent_message_chunk",
    "turn_end",
  ]);
  expect(body.events.find((e) => e.kind === "permission_resolved")).toMatchObject({
    by: "user",
    optionId: "yes",
  });

  // Cancel a parked permission: it resolves by cancel and the turn ends cancelled.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "permission again" });
  await until(read, id, (b) => openAsks(b).length === 1);
  await call("POST", `/pe/threads/${id}/cancel`);
  body = await until(read, id, (b) => turnEnds(b).length === 3);
  const cancelled = body.events.findLast((e) => e.kind === "permission_resolved");
  expect(cancelled).toMatchObject({ by: "cancel" });
  expect(cancelled).not.toHaveProperty("optionId");
  expect(turnEnds(body).at(-1)).toMatchObject({ stopReason: "cancelled" });

  // Cancel mid-turn, and a prompt sent while running waits in the queue, logged as `queued`.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "hang" });
  await until(read, id, (b) => b.running);
  const queued = await call("POST", `/pe/threads/${id}/prompt`, { text: "slow" });
  expect(queued.status).toBe(202);
  body = await read(id);
  expect(body.queued).toEqual([{ turnId: queued.json.turnId, text: "slow" }]);
  expect(body.events.at(-1)).toMatchObject({
    kind: "queued",
    turnId: queued.json.turnId,
    text: "slow",
  });
  // Cancel reads no body, so it needs no content type.
  expect((await bare(threads, "POST", `/pe/threads/${id}/cancel`)).status).toBe(200);
  body = await until(read, id, (b) => turnEnds(b).length === 5 && !b.running);
  expect(
    turnEnds(body)
      .slice(-2)
      .map((e) => e.kind === "turn_end" && e.stopReason),
  ).toEqual(["cancelled", "end_turn"]);
  expect(body.queued).toEqual([]);
  expect(body.events.map((e) => e.seq)).toEqual(body.events.map((_, i) => i + 1));

  // Model and traits (config option branch) go through ACP and land in the log.
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/trait`, { id: "effort", value: "high" });
  const fast = await call("POST", `/pe/threads/${id}/trait`, { id: "fast", value: true });
  expect(fast.json.traits.map((t: { current: unknown }) => t.current)).toEqual(["high", true]);
  body = await read(id);
  expect(body.modelId).toBe("m2");
  expect(body.events.slice(-3)).toMatchObject([
    { kind: "model_changed", modelId: "m2" },
    { kind: "trait_changed", traitId: "effort", value: "high" },
    { kind: "trait_changed", traitId: "fast", value: true },
  ]);
  // A trait the harness does not offer, or a value of the wrong kind, is refused.
  expect((await call("POST", `/pe/threads/${id}/trait`, { id: "nope", value: "x" })).status).toBe(
    502,
  );
  expect((await call("POST", `/pe/threads/${id}/trait`, { id: "fast", value: "on" })).status).toBe(
    502,
  );
  // A refused model surfaces the harness's own error; it does not fall through to `session/set_model`.
  const refused = await call("POST", `/pe/threads/${id}/model`, { modelId: "nope" });
  expect([refused.status, refused.json.error]).toEqual([
    502,
    expect.stringMatching(/Invalid params/),
  ]);

  // The harness names the session; a rename by the user is logged the same way.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "title" });
  body = await until(read, id, (b) => b.title === "Fake title" && !b.running);
  expect(kinds(body.events).slice(-3)).toEqual([
    "update:session_info_update",
    "title_changed",
    "turn_end",
  ]);
  expect((await call("PUT", `/pe/threads/${id}`, { title: "Renamed" })).json.title).toBe("Renamed");
  expect((await read(id)).events.at(-1)).toMatchObject({ kind: "title_changed", title: "Renamed" });

  // A route that reads a body refuses one without a JSON content type.
  expect((await bare(threads, "POST", `/pe/threads/${id}/prompt`)).status).toBe(415);

  // SSE replays after `after`, then tails live.
  body = await read(id);
  const after = body.events.length - 1;
  const response = await threads.fetch(
    new Request(`http://host/pe/threads/${id}/stream?after=${after}`),
  );
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const stream = response.body!.getReader();
  const seen: HarnessEvent[] = [];
  let buffer = "";
  const pump = async (count: number) => {
    while (seen.length < count) {
      buffer += new TextDecoder().decode((await stream.read()).value);
      for (const match of buffer.matchAll(/^data: (.*)$/gm)) seen.push(JSON.parse(match[1]!));
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
    }
  };
  await pump(1);
  expect(seen.map((e) => e.seq)).toEqual([after + 1]);
  await call("POST", `/pe/threads/${id}/prompt`, { text: "live" });
  await pump(5);
  expect(kinds(seen)).toEqual([
    "title_changed",
    "prompt",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  await stream.cancel();

  // A client that drops mid-stream ends its stream only; the thread keeps logging.
  const abort = new AbortController();
  const dropped = await threads.fetch(
    new Request(`http://host/pe/threads/${id}/stream`, { signal: abort.signal }),
  );
  const droppedReader = dropped.body!.getReader();
  await droppedReader.read();
  await call("POST", `/pe/threads/${id}/prompt`, { text: "hang" });
  await until(read, id, (b) => b.running);
  abort.abort();
  await call("POST", `/pe/threads/${id}/cancel`);
  body = await until(read, id, (b) => !b.running);
  expect(turnEnds(body).at(-1)).toMatchObject({ stopReason: "cancelled" });
  let done = false;
  while (!done) done = (await droppedReader.read()).done;
});

test("the thread head lives in meta.json, falls back for unknown ids, and is observable", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const threads = host();
  const call = caller(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const target = { kind: "named", session: "s1", address: "C:\\Models\\A.rvt" };
  const seen: ThreadHead[] = [];
  const release = threads.heads.observe(id, ({ value }) => seen.push(value));
  expect((await call("GET", `/pe/scope/${id}`)).json).toEqual({ defaultTarget: null, revision: 0 });
  const set = await call("PUT", `/pe/scope/${id}`, { defaultTarget: target, expectedRevision: 0 });
  expect(set).toEqual({
    status: 200,
    json: { ok: true, why: "set", head: { defaultTarget: target, revision: 1 } },
  });
  const stale = await call("PUT", `/pe/scope/${id}`, { defaultTarget: null, expectedRevision: 0 });
  expect([stale.status, stale.json.why]).toEqual([409, "stale"]);
  const meta = JSON.parse(await readFile(join(root, id, "meta.json"), "utf8"));
  expect(meta.head).toEqual({ defaultTarget: target, revision: 1 });
  await expect.poll(() => seen.at(-1)?.revision).toBe(1);
  release();

  // An id with no harness thread (an MCP child or the web named it first) still has a head.
  const loose = "not-a-harness-thread";
  expect(
    (await call("PUT", `/pe/scope/${loose}`, { defaultTarget: target, expectedRevision: 0 })).json
      .ok,
  ).toBe(true);
  expect((await caller(host())("GET", `/pe/scope/${loose}`)).json).toEqual({
    defaultTarget: target,
    revision: 1,
  });
});

test("a restarted host expires open asks, ends the open turn, resumes, and keeps the model", async () => {
  // The `models` shape: no config option, so the model goes through `session/set_model`.
  const first = host();
  const call = caller(first);
  const read = reader(first);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (b) => b.session === "started");
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/prompt`, { text: "permission" });
  const parked = await until(read, id, (b) => openAsks(b).length === 1);
  const turnId = parked.events.findLast((e) => e.kind === "prompt")!.turnId;
  const queued = await call("POST", `/pe/threads/${id}/prompt`, { text: "after restart" });
  expect(queued.status).toBe(202);
  await first.close();

  // A torn thread directory is skipped, never fatal.
  await mkdir(join(root, "torn"), { recursive: true });
  await writeFile(join(root, "torn", "meta.json"), "{ not json");

  const second = host();
  const reread = reader(second);
  const resumed = await until(
    reread,
    id,
    (b) => b.session === "resumed" && !b.running && b.queued.length === 0,
  );
  const tail = resumed.events.slice(parked.events.length + 1);
  expect(kinds(tail)).toEqual([
    "permission_resolved",
    "error",
    "prompt",
    "session",
    "model_changed",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  expect(tail[0]).toMatchObject({ by: "expired", requestId: openAsks(parked)[0]!.requestId });
  expect(tail[1]).toMatchObject({ turnId, message: "host restarted during this turn" });
  expect(tail[2]).toMatchObject({ turnId: queued.json.turnId, text: "after restart" });
  expect(resumed.modelId).toBe("m2");
  expect(
    (await caller(second)("GET", "/pe/threads")).json.map((t: { id: string }) => t.id),
  ).not.toContain("torn");
});

test("a question parks the turn, a fork copies the log, and a lost session re-feeds the transcript", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (b) => b.session === "started" && b.lastSeq === 1);

  // A form question parks the turn; the answer reaches the agent as the form's content.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "question" });
  let body = await until(read, id, (b) => openQuestions(b).length === 1);
  expect(body.running).toBe(true);
  const question = openQuestions(body)[0]!;
  expect(question).toMatchObject({
    message: "Which one?",
    requestedSchema: { required: ["pick"] },
  });
  expect(
    (await call("POST", `/pe/threads/${id}/question`, { requestId: "nope", action: "decline" }))
      .status,
  ).toBe(409);
  await call("POST", `/pe/threads/${id}/question`, {
    requestId: question.requestId,
    action: "accept",
    content: { pick: "b" },
  });
  body = await until(read, id, (b) => turnEnds(b).length === 1);
  expect(kinds(body.events).slice(1)).toEqual([
    "prompt",
    "update:agent_message_chunk",
    "question_request",
    "question_resolved",
    "update:agent_message_chunk",
    "turn_end",
  ]);
  expect(body.events.find((e) => e.kind === "question_resolved")).toMatchObject({
    by: "user",
    action: "accept",
    content: { pick: "b" },
  });
  expect(JSON.stringify(body.events)).toContain("answered b");

  // Cancel settles an open question; the agent reads it as cancelled.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "question" });
  await until(read, id, (b) => openQuestions(b).length === 1);
  await call("POST", `/pe/threads/${id}/cancel`);
  body = await until(read, id, (b) => turnEnds(b).length === 2);
  expect(body.events.findLast((e) => e.kind === "question_resolved")).toMatchObject({
    by: "cancel",
  });
  expect(lastEcho(body)).toBe("echo: question");

  // Same harness: the log is copied and the ACP session forked, so the model keeps its context.
  const fork = await call("POST", `/pe/threads/${id}/fork`, {});
  expect(fork.status).toBe(200);
  const forked = await until(read, fork.json.id, (b) => b.session === "forked");
  expect(forked.title).toBe("New thread (fork)");
  expect(forked.events.slice(0, body.events.length)).toEqual(body.events);
  expect(forked.events.at(-1)).toMatchObject({
    kind: "session",
    state: "forked",
    acpSessionId: "fake-session-fork",
  });
  await call("POST", `/pe/threads/${fork.json.id}/prompt`, { text: "hello" });
  const after = await until(read, fork.json.id, (b) => turnEnds(b).length === 3);
  expect(lastEcho(after)).toBe("echo: hello");

  // Another harness: no ACP fork; the first prompt carries the transcript, the record only the words.
  const cross = await call("POST", `/pe/threads/${id}/fork`, {
    providerId: "codex",
    title: "handoff",
  });
  const handoff = await until(read, cross.json.id, (b) => b.session === "detached");
  expect([handoff.harness, handoff.title]).toEqual(["codex", "handoff"]);
  await call("POST", `/pe/threads/${cross.json.id}/prompt`, { text: "go on" });
  const fed = await until(read, cross.json.id, (b) => turnEnds(b).length === 3);
  const echo = lastEcho(fed);
  expect({ echo, kinds: kinds(fed.events).slice(-8) }).toMatchObject({
    echo: expect.stringMatching(/^echo: \[Pea resumed this thread/),
  });
  expect(echo).toContain(
    'User: question\n\nPea: echo: question\n\nPea asked: Which one?\n\nUser answered: {"pick":"b"}\n\nPea: answered b\n\nUser: question\n\nPea: echo: question\n\nPea asked: Which one?\n\nUser did not answer (cancel).',
  );
  expect(echo).toMatch(/\[End of transcript\.\]\n\ngo on$/);
  expect(fed.events.findLast((e) => e.kind === "prompt")).toMatchObject({ text: "go on" });
  await call("POST", `/pe/threads/${cross.json.id}/prompt`, { text: "again" });
  expect(lastEcho(await until(read, cross.json.id, (b) => turnEnds(b).length === 4))).toBe(
    "echo: again",
  );

  // A stored session the harness no longer has: a new session, `detached`, the transcript re-fed.
  await threads.close();
  const metaPath = join(root, id, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as { acpSessionId: string };
  await writeFile(metaPath, JSON.stringify({ ...meta, acpSessionId: "lost" }));
  const second = host();
  await caller(second)("POST", `/pe/threads/${id}/prompt`, { text: "still there?" });
  const lost = await until(reader(second), id, (b) => turnEnds(b).length === 3);
  expect(lost.events.findLast((e) => e.kind === "session")).toMatchObject({ state: "detached" });
  expect(lastEcho(lost)).toMatch(/^echo: \[Pea resumed this thread/);
  expect(lost.session).toBe("detached");
}, 30_000);

test("a codex child gets Pea's developer instructions in CODEX_CONFIG; a claude child gets none", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const envLine = (body: HarnessThreadBody, name = "CODEX_CONFIG") =>
    body.events
      .flatMap((e) =>
        e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk"
          ? [(e.update as { content?: { text?: string } }).content?.text ?? ""]
          : [],
      )
      .find((text) => text.startsWith(`${name}=`))!
      .slice(name.length + 1);
  const codex = (await call("POST", "/pe/threads", { providerId: "codex" })).json.id as string;
  await call("POST", `/pe/threads/${codex}/prompt`, { text: "env" });
  const codexBody = await until(read, codex, (b) => turnEnds(b).length === 1);
  const config = JSON.parse(envLine(codexBody)) as { developer_instructions: string };
  // The user's PATH leads, the host's entries follow.
  expect(envLine(codexBody, "PATH").startsWith("C:\\canary-bin;C:\\also;")).toBe(true);
  expect(config.developer_instructions.startsWith("KERNEL: You are Pea.\n\n")).toBe(true);
  expect(config.developer_instructions).toContain("request_user_input");
  expect(config.developer_instructions).toContain("never call the sleep tool");
  const claude = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await call("POST", `/pe/threads/${claude}/prompt`, { text: "env" });
  const claudeBody = await until(read, claude, (b) => turnEnds(b).length === 1);
  expect(envLine(claudeBody)).toBe("");
  expect(envLine(claudeBody, "PATH").startsWith("C:\\canary-bin;")).toBe(true);
});

test("the user's own Codex MCP servers are read by header and written off by name", async () => {
  const config = join(root, "codex-config.toml");
  await writeFile(
    config,
    '[mcp_servers.foo]\ncommand = "x"\n[mcp_servers.foo.env]\nA = "1"\n[mcp_servers.bar]\n[other]\n',
  );
  expect(await userCodexMcpServers(config)).toEqual(["foo", "bar"]);
  expect(await userCodexMcpServers(join(root, "missing.toml"))).toEqual([]);
  expect(peaCodexProjectConfig(["foo", "bar"])).toBe(
    [
      "# Written by Pea at every host start. Your own Codex MCP servers (~/.codex/config.toml) stay",
      "# out of Pea threads; Pea attaches its own. Edits here are overwritten.",
      "",
      '[mcp_servers."foo"]',
      "enabled = false",
      "",
      '[mcp_servers."bar"]',
      "enabled = false",
      "",
    ].join("\n"),
  );
});

test("a header-less delete stops the child and removes the thread", async () => {
  const threads = host();
  const id = (await caller(threads)("POST", "/pe/threads", { providerId: "claude" })).json
    .id as string;
  await until(reader(threads), id, (b) => b.session === "started");
  expect((await bare(threads, "DELETE", `/pe/threads/${id}`)).status).toBe(204);
  expect((await caller(threads)("GET", `/pe/threads/${id}`)).status).toBe(404);
});

/** Every `NAME=value` line the fake echoed on "env". */
const said = (body: HarnessThreadBody, name: string) =>
  body.events
    .flatMap((e) =>
      e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk"
        ? [(e.update as { content?: { text?: string } }).content?.text ?? ""]
        : [],
    )
    .find((text) => text.startsWith(`${name}=`))
    ?.slice(name.length + 1);
async function envOf(threads: Host, providerId: string) {
  const call = caller(threads);
  const created = await call("POST", "/pe/threads", { providerId });
  expect(created.status).toBe(200);
  await call("POST", `/pe/threads/${created.json.id}/prompt`, { text: "env" });
  return until(reader(threads), created.json.id, (b) => turnEnds(b).length === 1);
}

test("providers list from the probe: readiness follows the adapter's own auth report", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const threads = host();
  const call = caller(threads);
  const listed = (await call("GET", "/pe/providers")).json as Provider[];
  expect(listed).toEqual(
    ["claude", "codex"].map((id) => ({
      id,
      harness: id,
      name: id === "claude" ? "Claude Code" : "Codex",
      auth: { kind: "subscription" },
      readiness: { state: "unknown", message: "Not probed yet." },
      models: [],
      traits: [],
      probedAt: null,
    })),
  );

  const ready = (await call("POST", "/pe/providers/claude/probe")).json as Provider;
  expect(ready.readiness).toEqual({ state: "ready" });
  expect(ready.models.map((m) => m.modelId)).toEqual(["m1", "m2"]);
  expect(ready.traits.map((t) => [t.id, t.kind])).toEqual([
    ["effort", "select"],
    ["fast", "boolean"],
  ]);
  expect(ready.probedAt).toEqual(expect.any(String));
  expect(((await call("GET", "/pe/providers")).json as Provider[])[0]).toEqual(ready);

  // Claude reports "Not logged in" and still opens a session; Codex refuses `session/new`.
  for (const auth of ["none", "required"]) {
    process.env.FAKE_ACP_AUTH = auth;
    const refused = (await call("POST", "/pe/providers/codex/probe")).json as Provider;
    expect(refused.readiness).toMatchObject({ state: "refused" });
    // `signed-in` when the user's codex.exe is found, else `installed`: the login needs the CLI.
    expect(["signed-in", "installed"]).toContain(
      refused.readiness.state === "refused" && refused.readiness.step,
    );
  }
  delete process.env.FAKE_ACP_AUTH;

  // Sign in opens the harness's own login (or its installer), then re-probes when the window closes.
  const step = ((await call("GET", "/pe/providers/codex")).json as Provider).readiness;
  expect((await call("POST", "/pe/providers/codex/open-login")).json).toEqual({ opened: true });
  expect(threads.consoles).toEqual([
    step.state === "refused" && step.step === "installed"
      ? "irm https://chatgpt.com/codex/install.ps1 | iex"
      : adapter.adapterLogin("codex"),
  ]);
  await expect
    .poll(async () => ((await call("GET", "/pe/providers/codex")).json as Provider).readiness)
    .toEqual({ state: "ready" });

  expect((await call("DELETE", "/pe/providers/claude")).status).toBe(409);
  expect((await call("POST", "/pe/providers/nope/probe")).status).toBe(404);
});

test("an endpoint provider is checked before save, and every thread carries its provider's env", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  process.env.FAKE_ACP_NATIVE_CURRENT = "gpt-4.1-mini";
  const hits: string[] = [];
  const inferred: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    const send = (status: number, body: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url?.startsWith("/bad/")) return send(503, { error: "auth_unavailable" });
    if (request.url === "/ok/v1/models")
      return send(200, {
        data: [
          { id: "gpt-image-1" },
          { id: "gpt-4.1-mini" },
          { id: "gpt-4.1" },
          { id: "gpt-6.1-sol" },
          { id: "gpt-5.6-sol" },
          { id: "gpt-5.2-codex" },
          { id: "claude-haiku-5-5" },
        ],
      });
    if (request.url === "/ok/v1/responses" || request.url === "/ok/v1/messages") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const model = JSON.parse(body).model;
        inferred.push(model);
        if (model === "gpt-5.2-codex") return send(404, { error: "model_not_found" });
        send(
          200,
          request.url === "/ok/v1/messages"
            ? { content: [{ type: "text", text: "OK" }] }
            : {
                output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
              },
        );
      });
      return;
    }
    send(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const codexKey = "sk-codex-secret-4321";
  const claudeKey = "sk-claude-secret-8765";
  try {
    const threads = host();
    const call = caller(threads);
    const add = (harness: string, name: string, baseUrl: string, apiKey: string) =>
      call("POST", "/pe/providers", { harness, name, auth: { kind: "endpoint", baseUrl, apiKey } });

    const refused = await add("codex", "Bad", `${origin}/bad/v1`, "sk-bad-0000");
    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({
      step: "endpoint",
      message: expect.stringMatching(/^models: HTTP 503 from .*auth_unavailable/),
    });
    expect((await add("codex", "Ftp", "ftp://x", "sk-x")).json.step).toBe("endpoint");
    expect((await call("GET", "/pe/providers")).json).toHaveLength(2);

    const vps = await add("codex", "VPS", `${origin}/ok/v1`, codexKey);
    expect(vps.status).toBe(200);
    expect(vps.json).toMatchObject({
      id: "codex-vps",
      harness: "codex",
      name: "VPS",
      auth: { kind: "endpoint", baseUrl: `${origin}/ok/v1`, keyLast4: "4321" },
      readiness: { state: "ready" },
    });
    expect(JSON.stringify(vps.json)).not.toContain(codexKey);
    expect(vps.json.models.map((m: { modelId: string }) => m.modelId)).toEqual([
      "gpt-6.1-sol",
      "gpt-5.6-sol",
      "gpt-5.2-codex",
    ]);
    // Claude's base is the origin the Anthropic client appends `/v1/messages` to.
    const gate = await add("claude", "Gate", `${origin}/ok/v1`, claudeKey);
    expect(gate.json).toMatchObject({ id: "claude-gate", auth: { baseUrl: `${origin}/ok` } });
    expect(gate.json.models.map((m: { modelId: string }) => m.modelId)).toEqual([
      "claude-haiku-5-5",
    ]);
    expect(inferred).toEqual(["gpt-6.1-sol", "claude-haiku-5-5"]);
    const explicit = await call("POST", "/pe/providers", {
      harness: "codex",
      name: "Explicit",
      auth: {
        kind: "endpoint",
        baseUrl: `${origin}/ok/v1`,
        apiKey: codexKey,
        modelId: "gpt-5.2-codex",
      },
    });
    expect(explicit.status).toBe(400);
    expect(explicit.json.message).toContain("gpt-5.2-codex");
    expect(explicit.json.message).toContain("Set Model");
    expect(hits).toEqual(
      expect.arrayContaining([
        "GET /ok/v1/models",
        "POST /ok/v1/responses",
        "POST /ok/v1/messages",
      ]),
    );
    expect((await add("codex", "vps", `${origin}/ok/v1`, codexKey)).status).toBe(409);
    expect((await call("POST", "/pe/providers/codex-vps/open-login")).status).toBe(409);
    expect(JSON.parse(await readFile(productProvidersPath(), "utf8")).providers).toHaveLength(2);

    // The CLI and web select a draft model immediately after creating a thread, while
    // its adapter is still connecting. No readiness poll belongs in either caller.
    for (const [providerId, modelId] of [
      ["codex-vps", "gpt-5.6-sol"],
      ["claude-gate", "claude-haiku-5-5"],
    ]) {
      const created = await call("POST", "/pe/threads", { providerId });
      const selected = await call("POST", `/pe/threads/${created.json.id}/model`, { modelId });
      expect([selected.status, selected.json.modelId]).toEqual([200, modelId]);
      await call("POST", `/pe/threads/${created.json.id}/prompt`, { text: "hang" });
      expect((await call("POST", `/pe/threads/${created.json.id}/model`, { modelId })).status).toBe(
        409,
      );
      await call("DELETE", `/pe/threads/${created.json.id}`);
    }

    // Subscription: the harness's own login, no endpoint env.
    const claudeSub = await envOf(threads, "claude");
    expect([said(claudeSub, "ANTHROPIC_BASE_URL"), said(claudeSub, "CODEX_CONFIG")]).toEqual([
      "",
      "",
    ]);
    const codexSub = await envOf(threads, "codex");
    expect(said(codexSub, "MODEL_PROVIDER")).toBe("");
    expect(JSON.parse(said(codexSub, "CODEX_CONFIG")!)).not.toHaveProperty("model_provider");

    // Endpoint: Codex gets the custom provider, Claude the Anthropic base URL and token.
    const codexEnd = await envOf(threads, "codex-vps");
    expect([codexEnd.providerId, codexEnd.providerName]).toEqual(["codex-vps", "VPS"]);
    expect(said(codexEnd, "MODEL_PROVIDER")).toBe("pea_endpoint");
    const config = JSON.parse(said(codexEnd, "CODEX_CONFIG")!);
    expect(config).toMatchObject({
      model_provider: "pea_endpoint",
      model_providers: {
        pea_endpoint: { base_url: `${origin}/ok/v1`, env_key: "PEA_ENDPOINT_API_KEY" },
      },
      developer_instructions: expect.stringMatching(/^KERNEL: You are Pea\./),
    });
    // The child got the key; the record keeps its last four.
    expect(said(codexEnd, "PEA_ENDPOINT_API_KEY")).toBe("…4321");
    expect(codexEnd.modelId).toBe("gpt-6.1-sol");
    expect(codexEnd.models).toEqual(vps.json.models);
    const switchModel = await call("POST", `/pe/threads/${codexEnd.id}/model`, {
      modelId: "gpt-5.6-sol",
    });
    expect(switchModel.status).toBe(200);
    expect(switchModel.json.modelId).toBe("gpt-5.6-sol");
    expect((await reader(threads)(codexEnd.id)).session).toBe("resumed");
    expect(
      (await call("POST", `/pe/threads/${codexEnd.id}/model`, { modelId: "gpt-5.2-codex" })).status,
    ).toBe(400);
    expect((await reader(threads)(codexEnd.id)).modelId).toBe("gpt-5.6-sol");
    expect(
      (await call("POST", `/pe/threads/${codexEnd.id}/model`, { modelId: "gpt-4.1-mini" })).status,
    ).toBe(400);
    const unsupported = await call("POST", "/pe/providers", {
      harness: "codex",
      name: "Unsupported",
      auth: {
        kind: "endpoint",
        baseUrl: `${origin}/ok/v1`,
        apiKey: codexKey,
        modelId: "gpt-4.1-mini",
      },
    });
    expect(unsupported.status).toBe(400);
    expect(unsupported.json.message).toContain("Codex metadata");
    expect(inferred).not.toContain("gpt-4.1-mini");
    const claudeEnd = await envOf(threads, "claude-gate");
    expect(said(claudeEnd, "ANTHROPIC_BASE_URL")).toBe(`${origin}/ok`);
    expect(said(claudeEnd, "ANTHROPIC_AUTH_TOKEN")).toBe("…8765");
    expect(said(claudeEnd, "CODEX_CONFIG")).toBe("");
    expect(claudeEnd.modelId).toBe("claude-haiku-5-5");
    expect(claudeEnd.models).toEqual(gate.json.models);
    for (const body of [codexEnd, claudeEnd]) {
      const log = await readFile(join(root, body.id, "events.jsonl"), "utf8");
      expect(log).not.toContain(codexKey);
      expect(log).not.toContain(claudeKey);
    }

    expect((await call("DELETE", "/pe/providers/codex-vps")).status).toBe(204);
    expect((await call("DELETE", "/pe/providers/claude-gate")).status).toBe(204);
    expect((await call("GET", "/pe/providers")).json).toHaveLength(2);
    expect((await call("POST", "/pe/threads", { providerId: "codex-vps" })).status).toBe(400);
  } finally {
    server.close();
    await rm(productProvidersPath(), { force: true });
  }
}, 30_000);

test("access picks the mode a session starts in: guarded is auto, unguarded bypasses", async () => {
  const threads = host();
  const call = caller(threads);
  try {
    expect((await call("GET", "/pe/access")).json).toEqual({ guarded: true });
    expect(said(await envOf(threads, "claude"), "MODE")).toBe("auto");
    expect((await call("PUT", "/pe/access", { guarded: false })).json).toEqual({ guarded: false });
    expect((await call("GET", "/pe/access")).json).toEqual({ guarded: false });
    expect(said(await envOf(threads, "codex"), "MODE")).toBe("bypassPermissions");
    expect((await bare(threads, "PUT", "/pe/access")).status).toBe(415);
    expect((await call("PUT", "/pe/access", { guarded: "no" })).status).toBe(400);
  } finally {
    await call("PUT", "/pe/access", { guarded: true });
  }
});

test("a turn that hears nothing for 60 s is marked waiting, once per 60 s, until it ends", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (b) => b.session === "started");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // Real time for the child's pipes; the host's clock is fake.
  const settle = async (done: (b: HarnessThreadBody) => boolean) => {
    const end = performance.now() + 5000;
    while (performance.now() < end) {
      const body = await read(id);
      if (done(body)) return body;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`timed out: ${JSON.stringify(await read(id))}`);
  };
  const waiting = (b: HarnessThreadBody) => b.events.filter((e) => e.kind === "waiting");
  await call("POST", `/pe/threads/${id}/prompt`, { text: "silent" });
  const turnId = (await settle((b) => b.running && lastEcho(b) === "echo: silent")).events.findLast(
    (e) => e.kind === "prompt",
  )!.turnId;
  await vi.advanceTimersByTimeAsync(WAITING_MS - 1);
  expect(waiting(await read(id))).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(waiting(await read(id))).toMatchObject([{ turnId, sinceMs: WAITING_MS }]);
  await vi.advanceTimersByTimeAsync(WAITING_MS);
  expect(waiting(await read(id)).map((e) => e.kind === "waiting" && e.sinceMs)).toEqual([
    WAITING_MS,
    2 * WAITING_MS,
  ]);
  await call("POST", `/pe/threads/${id}/cancel`);
  await settle((b) => !b.running);
  await vi.advanceTimersByTimeAsync(3 * WAITING_MS);
  expect(waiting(await read(id))).toHaveLength(2);
});
