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
  process.env.PE_HARNESS_ADAPTER_CODEX = process.env.PE_HARNESS_ADAPTER_CLAUDE;
});
afterEach(() => {
  delete process.env.FAKE_ACP_SHAPE;
});
afterAll(async () => {
  await Promise.all(hosts.map((threads) => threads.close()));
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  delete process.env.PE_HARNESS_ADAPTER_CODEX;
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
  expect(
    (await caller(second)("GET", "/pe/threads")).json.map((t: { id: string }) => t.id),
  ).not.toContain("torn");
});

test("a question parks the turn, a fork copies the log, and a lost session re-feeds the transcript", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { harness: "claude" })).json.id as string;
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
    harness: "codex",
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
