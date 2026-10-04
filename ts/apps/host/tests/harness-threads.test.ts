import { afterAll, afterEach, beforeAll, expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HarnessEvent, HarnessThreadBody, ThreadHead } from "@pe/agent-contracts";
import { createHarnessThreads } from "../src/harness/threads.ts";
import { productInferenceEndpointPath } from "../src/product-paths.ts";

let root = "";
let previousLocalAppData: string | undefined;
const hosts: ReturnType<typeof createHarnessThreads>[] = [];
const mcpServer = () => ({ name: "pea", command: "unused", args: [], env: [] });
const host = (spawn = true) => {
  const threads = createHarnessThreads({
    root,
    worldRoot: tmpdir(),
    mcpServer: spawn ? mcpServer : null,
  });
  hosts.push(threads);
  return threads;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-harness-"));
  // The saved inference endpoint resolves under this root, never the user's.
  previousLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
});
afterEach(() => {
  delete process.env.FAKE_ACP_SHAPE;
});
afterAll(async () => {
  await Promise.all(hosts.map((threads) => threads.close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  await rm(root, { recursive: true, force: true });
});

const caller =
  (threads: ReturnType<typeof createHarnessThreads>) =>
  async (method: string, path: string, body?: unknown) => {
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
const bare = (threads: ReturnType<typeof createHarnessThreads>, method: string, path: string) =>
  threads.fetch(new Request(`http://host${path}`, { method }));
const reader = (threads: ReturnType<typeof createHarnessThreads>) => async (id: string) =>
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
const turnEnds = (body: HarnessThreadBody) => body.events.filter((e) => e.kind === "turn_end");
/** The open asks: `permission_request`s with no `permission_resolved`. */
const openAsks = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "permission_request" &&
    !body.events.some((r) => r.kind === "permission_resolved" && r.requestId === e.requestId)
      ? [e]
      : [],
  );

test("a thread prompts, parks a permission, cancels, queues, renames, and replays over SSE", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const created = await call("POST", "/pe/threads", { harness: "claude" });
  const id = created.json.id as string;
  const started = await until(read, id, (b) => b.session === "started" && b.models.length > 0);
  expect(started.models.map((m) => m.modelId)).toEqual(["m1", "m2"]);
  expect([started.modelId, started.modeId, started.lastSeq]).toEqual(["m1", "default", 1]);

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

  // Model (config option branch) and mode go through ACP and land in the log.
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/mode`, { modeId: "plan" });
  body = await read(id);
  expect([body.modelId, body.modeId]).toEqual(["m2", "plan"]);
  expect(kinds(body.events).slice(-2)).toEqual(["model_changed", "mode_changed"]);
  // A refused model surfaces the harness's own error; it does not fall through to `session/set_model`.
  const refused = await call("POST", `/pe/threads/${id}/model`, { modelId: "nope" });
  expect([refused.status, refused.json.error]).toEqual([
    502,
    expect.stringMatching(/Invalid params/),
  ]);

  // A mode the harness switches on its own is logged like a user's.
  await call("POST", `/pe/threads/${id}/mode`, { modeId: "default" });
  await call("POST", `/pe/threads/${id}/prompt`, { text: "mode" });
  body = await until(read, id, (b) => b.modeId === "plan" && !b.running);
  expect(kinds(body.events).slice(-3)).toEqual([
    "update:current_mode_update",
    "mode_changed",
    "turn_end",
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
  const id = (await call("POST", "/pe/threads", { harness: "claude" })).json.id as string;
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

test("a restarted host expires open asks, ends the open turn, resumes, and keeps model and mode", async () => {
  // The `models` shape: no config option, so the model goes through `session/set_model`.
  const first = host();
  const call = caller(first);
  const read = reader(first);
  const id = (await call("POST", "/pe/threads", { harness: "claude" })).json.id as string;
  await until(read, id, (b) => b.session === "started");
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/mode`, { modeId: "plan" });
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
    "mode_changed",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  expect(tail[0]).toMatchObject({ by: "expired", requestId: openAsks(parked)[0]!.requestId });
  expect(tail[1]).toMatchObject({ turnId, message: "host restarted during this turn" });
  expect(tail[2]).toMatchObject({ turnId: queued.json.turnId, text: "after restart" });
  expect([resumed.modelId, resumed.modeId]).toEqual(["m2", "plan"]);
  // The `session/load` replay is history the log already holds.
  expect(JSON.stringify(resumed.events)).not.toContain("old replay");
  expect(
    (await caller(second)("GET", "/pe/threads")).json.map((t: { id: string }) => t.id),
  ).not.toContain("torn");
});

test("a host that cannot launch a Pea MCP server lists no harness and refuses new threads with 503", async () => {
  const call = caller(host(false));
  expect((await call("GET", "/pe/harnesses")).json).toEqual(
    ["claude", "codex"].map((id) =>
      expect.objectContaining({
        id,
        available: false,
        reason: "Harness threads need a source checkout in this build",
      }),
    ),
  );
  const response = await call("POST", "/pe/threads", { harness: "claude" });
  expect(response.status).toBe(503);
  expect(response.json.error).toMatch(/source checkout/);
});

test("a header-less delete stops the child and removes the thread", async () => {
  const threads = host();
  const id = (await caller(threads)("POST", "/pe/threads", { harness: "claude" })).json
    .id as string;
  await until(reader(threads), id, (b) => b.session === "started");
  expect((await bare(threads, "DELETE", `/pe/threads/${id}`)).status).toBe(204);
  expect((await caller(threads)("GET", `/pe/threads/${id}`)).status).toBe(404);
});

test("the saved endpoint key never lands in a thread record", async () => {
  const key = "sk-test-secret-9876";
  const saved = productInferenceEndpointPath();
  await mkdir(dirname(saved), { recursive: true });
  await writeFile(saved, JSON.stringify({ baseUrl: "http://x/v1", apiKey: key, probe: null }));
  try {
    const threads = host();
    const call = caller(threads);
    const read = reader(threads);
    const id = (await call("POST", "/pe/threads", { harness: "claude" })).json.id as string;
    await until(read, id, (b) => b.session === "started");
    await call("POST", `/pe/threads/${id}/prompt`, { text: `my key is ${key}` });
    const body = await until(read, id, (b) => turnEnds(b).length === 1);
    const log = await readFile(join(root, id, "events.jsonl"), "utf8");
    // The prompt and the harness's echo of it both carry the key; neither keeps it.
    expect(log).not.toContain(key);
    expect(log).toContain("…9876");
    expect(JSON.stringify(body.events)).not.toContain(key);
  } finally {
    await rm(saved);
  }
});
