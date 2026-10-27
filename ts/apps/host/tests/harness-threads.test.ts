import { createPeClient, servePeRoute } from "@pe/agent-contracts/pe-api";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { HostLog } from "../src/host-log.ts";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Caller,
  HarnessEvent,
  HarnessThreadBody,
  PluginHookName,
  PluginHooks,
} from "@pe/agent-contracts";
import { HARNESS_EVENT_MAX_BYTES } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { human } from "./callers.ts";
import {
  admitCrossing,
  bindControl,
  onRevoke,
  Refused,
  callerOf,
  originOf,
  assertRunAdmission,
} from "../src/control.ts";
import { createProviders } from "../src/harness/providers.ts";
import { createHarnessThreads, IDLE_CHILD_MS } from "../src/harness/threads.ts";
import * as adapter from "../src/harness/adapter.ts";
import { productProvidersPath } from "../src/product-paths.ts";
import { createUpdateReader, type UpdateRunner } from "../src/update-reader.ts";
import type { Envelope } from "@pe/host-contracts/pe-revit-contract";
import { sdkBinary, sdkCommand } from "./sdk-replay.ts";

let root = "";
let previousLocalAppData: string | undefined;
type Host = {
  fetch: (request: Request) => Promise<Response>;
  /** Who every request crosses as: the identity middleware's stand-in. */
  as: Caller;
  launchScheduled: ReturnType<typeof createHarnessThreads>["launchScheduled"];
  heads: ReturnType<typeof createHarnessThreads>["heads"];
  observe: ReturnType<typeof createHarnessThreads>["observe"];
  runs: ReturnType<typeof createHarnessThreads>["runs"];
  log: HostLog;
  close: () => Promise<unknown>;
  consoles: string[];
};
const hosts: Host[] = [];
const mcpServer = () => ({ name: "pea", command: "unused", args: [], env: [] });
/** Threads and providers behind one fetch, as the host's router mounts them. No probe at start. */
const host = (
  updatePending?: () => boolean,
  prepare?: () => Promise<unknown>,
  openConsole: (command: string, opened: () => void) => Promise<void> = async (_, opened) =>
    opened(),
  pluginHook?: <N extends PluginHookName>(name: N, event: PluginHooks[N]) => Promise<void>,
): Host => {
  const consoles: string[] = [];
  const providers = createProviders({
    shellPath: async () => "C:\\canary-bin;C:\\also",
    probeOnStart: false,
    openConsole: async (command, _env, opened) => {
      consoles.push(command);
      await openConsole(command, opened);
      return { exitCode: 0, commandExitCode: 0, logPath: join(root, "console.log") };
    },
  });
  const log = new HostLog(join(root, ".log", randomUUID()));
  const threads = createHarnessThreads({
    log,
    prepare,
    pluginHook,
    updatePending,
    root,
    worldRoot: tmpdir(),
    mcpServer,
    developerInstructions: async () => "KERNEL: You are Pea.",
    providers,
  });
  const routed: Host = {
    as: human,
    fetch: (request) =>
      withInvocationContext({ caller: routed.as }, () =>
        /^\/pe\/(providers|access)/.test(new URL(request.url).pathname)
          ? providers.fetch(request)
          : threads.fetch(request),
      ),
    launchScheduled: threads.launchScheduled,
    heads: threads.heads,
    observe: threads.observe,
    runs: threads.runs,
    log,
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
  vi.unstubAllEnvs();
  delete process.env.FAKE_ACP_SHAPE;
  delete process.env.FAKE_ACP_AUTH;
  delete process.env.FAKE_ACP_GATE;
  delete process.env.FAKE_ACP_NATIVE_CURRENT;
  delete process.env.FAKE_ACP_PROMPT;
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
  // A client mints one id per prompt; a test that names none sends a fresh one.
  if (path.endsWith("/prompt") && body && typeof body === "object" && !("id" in body))
    body = { id: randomUUID(), ...body };
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
  events
    .filter(
      (event, index) =>
        event.kind !== "run_consent" &&
        event.kind !== "starting" &&
        (event.kind !== "session" || events.findIndex((item) => item.kind === "session") === index),
    )
    .map((e) => (e.kind === "update" ? `update:${e.update.sessionUpdate}` : e.kind));

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
    binary: sdkBinary,
    command: sdkCommand,
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
    expect((await read(id)).events.some((e) => e.kind === "prompt")).toBe(false);
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

test("turn children retire while conversation history and model choices survive", async () => {
  process.env.FAKE_ACP_SHAPE = "config";
  const h = host(),
    call = caller(h),
    read = reader(h);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await until(read, id, (body) => body.models.length > 0);
  await call("POST", `/pe/threads/${id}/model`, { modelId: "m2" });
  await call("POST", `/pe/threads/${id}/trait`, { id: "effort", value: "high" });
  await call("POST", `/pe/threads/${id}/prompt`, { text: "pid" });
  const before = await until(
    read,
    id,
    (body) => !body.running && turnEnds(body).length === 1 && body.session === "closed",
  );
  expect(before.modelId).toBe("m2");
  await call("POST", `/pe/threads/${id}/prompt`, { text: "after retirement" });
  const after = await until(
    read,
    id,
    (body) => !body.running && turnEnds(body).length === 2 && body.session === "closed",
  );
  expect(after.modelId).toBe("m2");
  expect(after.traits.find((trait) => trait.id === "effort")?.current).toBe("high");
  expect(after.events.slice(0, before.events.length)).toEqual(before.events);
  expect(
    after.events.filter((event) => event.kind === "session" && event.state === "resumed").length,
  ).toBeGreaterThanOrEqual(2);
  await h.close();
});

test("connect, model/trait RPCs, active turns and asks prevent idle reaping", async () => {
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
      await vi.advanceTimersByTimeAsync(2 * IDLE_CHILD_MS);
      const active = await read(id);
      expect(active.session).toBe("resumed");
      expect(active.running).toBe(true);
      await call("POST", `/pe/threads/${id}/cancel`);
      await untilIo(
        () => read(id),
        (b) => !b.running,
      );
    }
  } finally {
    await rm(gates, { recursive: true, force: true });
    await threads.close();
  }
});

test("a thread prompts, parks a permission, cancels, interrupts, renames, and replays over SSE", async () => {
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
    "turn_element_targets",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  expect(body.events.map((e) => e.seq)).toEqual(
    Array.from({ length: body.events.length }, (_, index) => index + 1),
  );
  expect(body.lastSeq).toBe(body.events.length);

  // Permission parks the turn until answered.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "ask permission" });
  body = await until(read, id, (b) => openAsks(b).length === 1);
  expect(body.running).toBe(true);
  const ask = openAsks(body)[0]!;
  for (const change of [
    { status: "settled" },
    { status: "archived" },
    { snoozedUntil: "2099-10-11T12:00:00.000Z" },
  ])
    expect(
      (
        await call("PUT", `/pe/threads/${id}`, {
          expectedRevision: body.lifecycle.revision,
          ...change,
        })
      ).status,
    ).toBe(409);
  expect((await read(id)).activity).toMatchObject({ state: "waiting", pending: 1 });
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
  expect(kinds(body.events).slice(6)).toEqual([
    "prompt",
    "turn_element_targets",
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

  // A prompt sent while a turn runs interrupts it: the turn ends cancelled, then the new one starts.
  await call("POST", `/pe/threads/${id}/prompt`, { text: "hang" });
  await until(read, id, (b) => lastEcho(b) === "echo: hang");
  const interrupting = await call("POST", `/pe/threads/${id}/prompt`, { text: "slow" });
  expect(interrupting.status).toBe(200);
  body = await until(read, id, (b) => turnEnds(b).length === 5 && !b.running);
  expect(
    body.events
      .flatMap((e) =>
        e.kind === "prompt"
          ? [`prompt ${e.text}`]
          : e.kind === "turn_end"
            ? [`end ${e.stopReason}`]
            : [],
      )
      .slice(-4),
  ).toEqual(["prompt hang", "end cancelled", "prompt slow", "end end_turn"]);
  expect(body.events.findLast((e) => e.kind === "prompt")).toMatchObject({
    turnId: interrupting.json.turnId,
  });
  // Cancel reads no body, so it needs no content type.
  expect((await bare(threads, "POST", `/pe/threads/${id}/cancel`)).status).toBe(200);
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
}, 30_000);

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
  await first.close();

  // A torn thread directory is skipped, never fatal.
  await mkdir(join(root, "torn"), { recursive: true });
  await writeFile(join(root, "torn", "meta.json"), "{ not json");

  const second = host();
  const reread = reader(second);
  const recall = caller(second);
  expect((await recall("POST", `/pe/threads/${id}/prompt`, { text: "after restart" })).status).toBe(
    200,
  );
  const resumed = await until(
    reread,
    id,
    (b) => b.session === "closed" && !b.running && turnEnds(b).length === 1,
  );
  const tail = resumed.events
    .slice(parked.events.length)
    .filter((event) => event.kind !== "run_consent");
  expect(kinds(tail)).toEqual([
    "permission_resolved",
    "error",
    "prompt",
    "turn_element_targets",
    "session",
    "model_changed",
    "update:agent_message_chunk",
    "update:tool_call",
    "turn_end",
  ]);
  expect(tail[0]).toMatchObject({ by: "expired", requestId: openAsks(parked)[0]!.requestId });
  expect(tail[1]).toMatchObject({ turnId, message: "host restarted during this turn" });
  expect(tail[2]).toMatchObject({ text: "after restart" });
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
    "turn_element_targets",
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
  expect(lost.session).toBe("closed");
}, 30_000);

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

test("subscription children exclude inherited inference credentials without changing the host", async () => {
  const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
  for (const name of names) vi.stubEnv(name, "synthetic-inherited-credential");
  const threads = host();
  for (const provider of ["claude", "codex"]) {
    const body = await envOf(threads, provider);
    for (const name of names) expect(said(body, name)).toBe("");
  }
  for (const name of names) expect(process.env[name]).toBe("synthetic-inherited-credential");
});

async function envOf(threads: Host, providerId: string) {
  const call = caller(threads);
  const created = await call("POST", "/pe/threads", { providerId });
  expect(created.status).toBe(200);
  await call("POST", `/pe/threads/${created.json.id}/prompt`, { text: "env" });
  return until(reader(threads), created.json.id, (b) => turnEnds(b).length === 1);
}

test("an endpoint provider is checked before save, and every thread carries its provider's env", async () => {
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://inherited.invalid");
  vi.stubEnv("MODEL_PROVIDER", "inherited-provider");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-inherited-key");
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
      message: "unreachable: Endpoint unreachable or unavailable.",
      failure: {
        kind: "unreachable",
        message: "unreachable: Endpoint unreachable or unavailable.",
        raw: JSON.stringify({ error: "auth_unavailable" }),
      },
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
    expect(explicit.json.failure.kind).toBe("model");
    expect(explicit.json.failure.raw).toContain("gpt-5.2-codex");
    expect(explicit.json.failure.raw).toContain("Set Model");
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
    expect(said(codexEnd, "OPENAI_API_KEY")).toBe("");
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
    expect(said(claudeEnd, "MODEL_PROVIDER")).toBe("");
    expect(said(claudeEnd, "ANTHROPIC_BASE_URL")).toBe(`${origin}/ok`);
    expect(said(claudeEnd, "ANTHROPIC_AUTH_TOKEN")).toBe("…8765");
    expect(said(claudeEnd, "CODEX_CONFIG")).toBe("");
    expect(claudeEnd.modelId).toBe("claude-haiku-5-5");
    expect(claudeEnd.models).toEqual(gate.json.models);
    await call("POST", `/pe/threads/${claudeEnd.id}/prompt`, { text: "credit-refusal" });
    const failed = await until(
      reader(threads),
      claudeEnd.id,
      (body) => !body.running && body.events.some((event) => event.kind === "error"),
    );
    const refusal = failed.events.findLast((event) => event.kind === "error");
    expect(refusal).toMatchObject({
      message: "billing: Out of credit or billing limit reached.",
      failure: { kind: "billing", raw: expect.stringContaining("credit balance") },
    });
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

test("both harnesses retain journal-safe modes even when access was Full", async () => {
  const threads = host();
  const call = caller(threads);
  try {
    expect((await call("GET", "/pe/access")).json).toEqual({ guarded: true });
    expect(said(await envOf(threads, "claude"), "MODE")).toBe("default");
    expect((await call("PUT", "/pe/access", { guarded: false })).json).toEqual({ guarded: false });
    expect((await call("GET", "/pe/access")).json).toEqual({ guarded: false });
    expect(said(await envOf(threads, "codex"), "MODE")).toBe("read-only");
    expect((await bare(threads, "PUT", "/pe/access")).status).toBe(415);
    expect((await call("PUT", "/pe/access", { guarded: "no" })).status).toBe(400);
  } finally {
    await call("PUT", "/pe/access", { guarded: true });
  }
});

// A 1x1 PNG, the same fixture the Mastra-era attachment test used.

/* ── The thread's targets: doors 6, 7 and 8 (ADR 0017, ADR 0021) ─────────────────────── */

const T0 = Date.parse("2026-10-12T12:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();
const yours = { kind: "open", ref: { session: "S1", openId: "A" } } as const;
const theirs = { kind: "open", ref: { session: "S2", openId: "B" } } as const;
const peas = { kind: "open", ref: { session: "P", openId: "copy" } } as const;
/** Pea acquired the copy in Revit "P"; a user document opened there later is not acquired. */
const peaAcquiredCopy = {
  acquired: (ref: { session: string; openId: string }) =>
    ref.session === "P" && ref.openId === "copy" ? "acq-copy" : null,
  acquiredSession: (session: string) => (session === "P" ? "acq-P" : null),
};
const userInPeas = { kind: "open", ref: { session: "P", openId: "B" } } as const;
const peaOf = (thread: string): Caller => ({ kind: "pea", context: `ctx-${thread}`, thread });
const onDoc = (ref: { session: string; openId: string }) => ({ kind: "document", ref }) as const;
const put = (...requests: unknown[]) => requests.map((request) => ({ request }));

test("access-050: fork retains the targets but never inherits a human admission", async () => {
  const threads = host();
  const call = caller(threads);
  const created = await call("POST", "/pe/threads", { providerId: "claude" });
  const id = created.json.id;
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(threads.heads.read(id).targets[0]?.admission).not.toBeNull();
  const forked = await call("POST", `/pe/threads/${id}/fork`, {});
  expect(forked.status).toBe(200);
  expect(threads.heads.read(forked.json.id)).toEqual({
    targets: [{ request: yours, admission: null }],
    revision: 0,
  });
});
const crossing = (caller: Caller, ref: { session: string; openId: string }) => {
  try {
    return admitCrossing(caller, onDoc(ref), "/actions");
  } catch (error) {
    if (error instanceof Refused) return error.refusal.code;
    throw error;
  }
};
afterEach(() =>
  bindControl({
    heads: null,
    acquired: () => null,
    acquiredSession: () => null,
    fullAccess: () => false,
  }),
);

test("door 6: a human adds your open lifetimes with an admission; Pea's own and named targets hold none", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  bindControl(peaAcquiredCopy);
  const call = caller(host());
  const id = "target-door-6";
  const set = await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(set.status).toBe(200);
  expect(set.json.head).toEqual({
    revision: 1,
    targets: [{ request: yours, admission: { revision: 1, at: at(T0), via: "local" } }],
  });
  // Adding a second document keeps the first one's admission as it was.
  const named = { kind: "named", session: "S1", address: "C:/Models/A.rvt" };
  const both = await call("PUT", `/pe/scope/${id}`, {
    targets: put(yours, named, peas, userInPeas),
    expectedRevision: 1,
  });
  expect(both.json.head.targets.map((t: { admission: unknown }) => t.admission)).toEqual([
    { revision: 1, at: at(T0), via: "local" },
    null,
    null,
    // A user's document inside Pea's Revit is yours: adding it admits it like any other.
    { revision: 2, at: at(T0), via: "local" },
  ]);
  const stale = await call("PUT", `/pe/scope/${id}`, { targets: [], expectedRevision: 1 });
  expect([stale.status, stale.json.why]).toEqual([409, "stale"]);
  const twice = await call("PUT", `/pe/scope/${id}`, {
    targets: put(yours, yours),
    expectedRevision: 2,
  });
  expect(twice.status).toBe(403);
});

test("thread target changes preserve Pea capability and retain revocation for external grants", async () => {
  const h = host();
  bindControl({ heads: h.heads.read });
  const call = caller(h),
    id = "target-context";
  const retired: string[] = [];
  const release = onRevoke((thread, lifetime) => retired.push(`${thread}:${lifetime.openId}`));
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  expect(crossing(peaOf(id), theirs.ref)).toBeNull();
  await call("PUT", `/pe/scope/${id}`, { targets: [], expectedRevision: 1 });
  expect(retired).toEqual([`${id}:A`]);
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  release();
});

test("Pea context targets are editable defaults and mint no external write admission", async () => {
  const h = host(),
    call = caller(h),
    id = "context-only";
  h.as = peaOf(id);
  const selected = await call("PUT", "/pe/scope/self", {
    targets: put(yours, theirs),
    expectedRevision: 0,
  });
  expect(selected.status).toBe(200);
  expect(
    selected.json.head.targets.map((target: { admission: unknown }) => target.admission),
  ).toEqual([null, null]);
  expect(
    (await call("PUT", "/pe/scope/foreign", { targets: [], expectedRevision: 0 })).status,
  ).toBe(403);
});

test("Pea cannot create its own independent prompt and target selection grants no write", async () => {
  const h = host(),
    call = caller(h),
    id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id;
  await call("PUT", `/pe/scope/${id}`, { targets: put(yours), expectedRevision: 0 });
  h.as = peaOf(id);
  expect((await call("POST", `/pe/threads/${id}/prompt`, { text: "renew me" })).status).toBe(403);
  expect(crossing(peaOf(id), yours.ref)).toBeNull();
  expect(() => assertRunAdmission(originOf(peaOf(id)))).toThrow("run.none");
  await h.close();
});

/* ── The prompt inbox: client ids, queue and steer, and wait ─────────────────────────────── */

const story = (body: HarnessThreadBody) =>
  body.events.flatMap((e) =>
    e.kind === "prompt"
      ? [`prompt ${e.text}`]
      : e.kind === "prompt_queued"
        ? [`queued ${e.text}`]
        : e.kind === "prompt_dropped"
          ? [`dropped ${e.by}`]
          : e.kind === "turn_end"
            ? [`end ${e.stopReason}`]
            : [],
  );

test("a prompt id is the turn id: a retry never sends twice, other content under it is refused", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const turnId = randomUUID();
  const first = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "hello" });
  expect(first.json).toMatchObject({ turnId, state: "running" });
  const retry = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "hello" });
  expect([retry.status, retry.json.turnId]).toEqual([200, turnId]);
  const other = await call("POST", `/pe/threads/${id}/prompt`, { id: turnId, text: "other" });
  expect(other.status).toBe(409);
  const body = await until(read, id, (b) => turnEnds(b).length === 1 && !b.running);
  expect(story(body)).toEqual(["prompt hello", "end end_turn"]);
  expect(body.events.find((e) => e.kind === "prompt")).toMatchObject({ turnId });
  const unnamed = await threads.fetch(
    new Request(`http://host/pe/threads/${id}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "no id" }),
    }),
  );
  expect(unnamed.status).toBe(400);
});

test("queue order holds under steer: the steer runs next, then the queue in order", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  const prompt = (text: string, delivery: "steer" | "queue") =>
    call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text, delivery });
  await prompt("hang", "steer");
  await until(read, id, (b) => lastEcho(b) === "echo: hang");
  expect((await prompt("one", "queue")).json.state).toBe("queued");
  expect((await prompt("two", "queue")).json.state).toBe("queued");
  const steered = await prompt("slow", "steer");
  expect(steered.json.state).toBe("running");
  const body = await until(read, id, (b) => turnEnds(b).length === 4 && !b.running);
  expect(story(body)).toEqual([
    "prompt hang",
    "queued one",
    "queued two",
    "end cancelled",
    "prompt slow",
    "end end_turn",
    "prompt one",
    "end end_turn",
    "prompt two",
    "end end_turn",
  ]);
});

test("a restarted host drops the prompts it had queued, saying so", async () => {
  const first = host();
  const call = caller(first);
  const read = reader(first);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await call("POST", `/pe/threads/${id}/prompt`, { id: randomUUID(), text: "hang" });
  await until(read, id, (b) => lastEcho(b) === "echo: hang");
  const queued = randomUUID();
  await call("POST", `/pe/threads/${id}/prompt`, { id: queued, text: "later", delivery: "queue" });
  await first.close();
  const second = host();
  const body = await reader(second)(id);
  expect(body.events.at(-1)).toMatchObject({
    kind: "prompt_dropped",
    turnId: queued,
    by: "expired",
  });
  expect((await caller(second)("GET", `/pe/threads/${id}/wait?turn=${queued}`)).json).toEqual({
    turnId: queued,
    state: "dropped",
  });
});

test("declared client and actual harness handler share input, output and refusal contracts", async () => {
  const owner = host();
  const client = createPeClient("http://host", (url, init) =>
    servePeRoute(new Request(url, init), owner.fetch),
  );
  const thread = await client.call("threads.create", {
    body: { providerId: "claude", title: "contract" },
  });
  const params = { id: thread.id };
  expect((await client.call("thread.get", { params })).title).toBe("contract");
  expect((await client.call("thread.update", { params, body: { title: "renamed" } })).title).toBe(
    "renamed",
  );
  expect((await client.call("scope.get", { params })).revision).toBe(0);
  await expect(
    client.call("thread.question", { params, body: { requestId: "gone", action: "decline" } }),
  ).rejects.toMatchObject({ status: 409, message: "No pending question gone" });
  await client.call("thread.remove", { params });
  await expect(client.call("thread.get", { params })).rejects.toMatchObject({ status: 404 });
});

test("one huge tool result is kept bounded in the record, the log and every reader", async () => {
  const threads = host();
  const call = caller(threads);
  const read = reader(threads);
  const id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
  await call("POST", `/pe/threads/${id}/prompt`, { text: "huge" });
  const body = await until(read, id, (b) => turnEnds(b).length === 1);
  const updates = body.events.filter(
    (e): e is Extract<HarnessEvent, { kind: "update" }> =>
      e.kind === "update" && ["t-huge", "t-wide"].includes(String(e.update.toolCallId)),
  );
  expect(updates).toHaveLength(2);
  for (const e of updates) {
    expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThan(HARNESS_EVENT_MAX_BYTES);
    expect(e.update.truncated).toBeGreaterThan(HARNESS_EVENT_MAX_BYTES);
  }
  // A long string keeps its head; a wide structure keeps the call's identity.
  expect(JSON.stringify(updates[0]!.update)).toContain("characters not kept");
  expect(updates[1]!.update).toMatchObject({ toolCallId: "t-wide", status: "completed" });
  expect((await stat(join(root, id, "events.jsonl"))).size).toBeLessThan(
    4 * HARNESS_EVENT_MAX_BYTES,
  );
  expect(threads.log.read(0).entries.some((e) => e.event.kind === "oversize")).toBe(false);
});

for (const harness of ["claude", "codex"] as const) {
  test(`${harness}: delayed invocation and CLI child retain immutable old run across the next turn`, async () => {
    const calls: { token: string; harness: string }[] = [];
    const realOpen = adapter.openAdapter;
    const launched = vi.spyOn(adapter, "openAdapter").mockImplementation((...args) => {
      calls.push({ harness: args[0], token: args[2].PE_CONTEXT ?? "" });
      return realOpen(...args);
    });
    const h = host(),
      call = caller(h),
      read = reader(h);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      const oldId = randomUUID();
      await call("POST", `/pe/threads/${id}/prompt`, { id: oldId, text: "env" });
      await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
      const minted = calls.map((entry) => ({
        entry,
        resolved: callerOf({ kind: "local" }, { "x-pe-context": entry.token }),
      }));
      const old = minted.find(
        (entry) =>
          "caller" in entry.resolved &&
          entry.resolved.caller.kind === "pea" &&
          entry.resolved.caller.run?.turn === oldId,
      )!;
      expect(old).toBeDefined();
      expect(old.entry.harness).toBe(harness);
      const oldCaller = "caller" in old.resolved ? old.resolved.caller : null;
      expect(oldCaller?.kind).toBe("pea");
      const next = randomUUID();
      await call("POST", `/pe/threads/${id}/prompt`, { id: next, text: "hang" });
      await until(
        read,
        id,
        (body) =>
          body.running &&
          body.events.some(
            (event) =>
              event.kind === "session" &&
              event.seq > body.events.findLast((event) => event.kind === "prompt")!.seq,
          ),
      );
      // This is the exact token a delayed MCP invocation and a background CLI inherited.
      const delayed = callerOf({ kind: "local" }, { "x-pe-context": old.entry.token });
      expect(delayed).toEqual(old.resolved);
      expect(() => assertRunAdmission(originOf(oldCaller!))).toThrow("run.closed");
      const scoped = calls
        .map((entry) => callerOf({ kind: "local" }, { "x-pe-context": entry.token }))
        .find(
          (resolved) =>
            "caller" in resolved &&
            resolved.caller.kind === "pea" &&
            resolved.caller.run?.turn === next,
        );
      expect(
        scoped && "caller" in scoped && scoped.caller.kind === "pea" ? scoped.caller.run : null,
      ).toEqual({ thread: id, turn: next });
      await call("POST", `/pe/threads/${id}/cancel`);
      await until(read, id, (body) => !body.running);
    } finally {
      launched.mockRestore();
      await h.close();
    }
  }, 15000);
  test(`${harness}: a native write approval is refused with the host-command boundary`, async () => {
    const h = host(),
      call = caller(h),
      read = reader(h);
    try {
      const id = (await call("POST", "/pe/threads", { providerId: harness })).json.id as string;
      await until(read, id, (body) => body.models.length > 0);
      await call("POST", `/pe/threads/${id}/prompt`, { text: "permission raw-write" });
      const body = await until(read, id, (body) => !body.running && turnEnds(body).length === 1);
      expect(openAsks(body)).toHaveLength(0);
      expect(
        body.events.some(
          (event) =>
            event.kind === "update" &&
            String(event.update.title).includes("Native unjournaled writes are unsupported"),
        ),
      ).toBe(true);
      expect(
        body.events.some(
          (event) =>
            event.kind === "update" &&
            event.update.sessionUpdate === "agent_message_chunk" &&
            String((event.update.content as { text?: string })?.text).includes("chose no"),
        ),
      ).toBe(true);
    } finally {
      await h.close();
    }
  });
}

test("recorded run permission answers survive reconnect and restart without approving an old run", async () => {
  const h = host(),
    call = caller(h),
    read = reader(h),
    id = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string,
    turn = randomUUID();
  await until(read, id, (body) => body.models.length > 0);
  await call("POST", `/pe/threads/${id}/prompt`, { id: turn, text: "hang" });
  await until(read, id, (body) => lastEcho(body) === "echo: hang");
  const run = { thread: id, turn },
    by: Caller = { kind: "pea", context: "host-fixture", thread: id, run, root: run };
  const authorized = h.runs.authorize(originOf(by), "command", [
    { kind: "file", path: "C:/user/result.json" },
  ]);
  const body = await until(read, id, (body) => openAsks(body).some((ask) => ask.scope === "run")),
    ask = openAsks(body).find((ask) => ask.scope === "run")!;
  const first = await call("POST", `/pe/threads/${id}/permission`, {
    requestId: ask.requestId,
    optionId: "allow_now",
  });
  expect(first.status).toBe(200);
  await authorized;
  const repeated = await call("POST", `/pe/threads/${id}/permission`, {
    requestId: ask.requestId,
    optionId: "stop_writes",
  });
  expect(repeated.json.decision).toEqual(first.json.decision);
  await h.close();
  const restarted = host(),
    again = caller(restarted);
  try {
    const recovered = await again("POST", `/pe/threads/${id}/permission`, {
      requestId: ask.requestId,
      optionId: "allow_now",
    });
    expect(recovered.json.decision).toEqual(first.json.decision);
    expect(() => restarted.runs.assertOpen(originOf(by))).toThrow("run.closed");
  } finally {
    await restarted.close();
  }
});

test("delegated thread processes carry host-bound root consent and Stop", async () => {
  const tokens: string[] = [];
  const realOpen = adapter.openAdapter;
  const launched = vi.spyOn(adapter, "openAdapter").mockImplementation((...args) => {
    tokens.push(args[2].PE_CONTEXT ?? "");
    return realOpen(...args);
  });
  const h = host(),
    call = caller(h),
    read = reader(h);
  const minted = (turn: string) => {
    for (const token of tokens) {
      const identity = callerOf({ kind: "local" }, { "x-pe-context": token });
      if (
        "caller" in identity &&
        identity.caller.kind === "pea" &&
        identity.caller.run?.turn === turn
      )
        return identity.caller;
    }
    throw Error("No host-issued run token");
  };
  try {
    const parent = (await call("POST", "/pe/threads", { providerId: "claude" })).json.id as string;
    const parentTurn = randomUUID(),
      childTurn = randomUUID();
    await until(read, parent, (body) => body.models.length > 0);
    await call("POST", `/pe/threads/${parent}/prompt`, { id: parentTurn, text: "hang" });
    await until(read, parent, (body) => lastEcho(body) === "echo: hang");
    const parentCaller = minted(parentTurn);
    h.as = parentCaller;
    const child = (await call("POST", "/pe/threads", { providerId: "codex", delegated: true })).json
      .id as string;
    expect(
      (await call("POST", `/pe/threads/${child}/prompt`, { id: childTurn, text: "hang" })).status,
    ).toBe(200);
    await until(read, child, (body) => lastEcho(body) === "echo: hang");
    const childCaller = minted(childTurn);
    expect(childCaller.root).toEqual(parentCaller.run);
    const pending = h.runs.authorize(originOf(childCaller), "child-command", [
      { kind: "file", path: "C:/user/shared.json" },
    ]);
    h.as = human;
    const asking = await until(read, parent, (body) =>
      openAsks(body).some((ask) => ask.scope === "run"),
    );
    const ask = openAsks(asking).find((ask) => ask.scope === "run")!;
    await call("POST", `/pe/threads/${parent}/permission`, {
      requestId: ask.requestId,
      optionId: "allow_now",
    });
    const consent = await pending;
    expect(
      await h.runs.authorize(originOf(parentCaller), "parent-command", [
        { kind: "file", path: "C:/user/other.json" },
      ]),
    ).toEqual(consent);
    await call("POST", `/pe/threads/${parent}/cancel`);
    expect(() => h.runs.checkpoint(originOf(childCaller), consent)).toThrow("consent.stopped");
    await call("POST", `/pe/threads/${child}/cancel`);
  } finally {
    launched.mockRestore();
    await h.close();
  }
}, 15000);
