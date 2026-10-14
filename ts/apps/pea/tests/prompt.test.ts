import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import {
  emptyThreadHead,
  emptyThreadLifecycle,
  type HarnessThreadSummary,
  type HarnessEvent,
} from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import {
  checkoutRootFrom,
  sourceHostServiceName,
  productRoot,
} from "@pe/host-contracts/service-identity";
import { serviceFilePath } from "@pe/host-contracts/pe-service";
import { runPeaPromptTurn } from "../src/prompt.ts";
import { withInvocationContext } from "@pe/mcps/context";

const { ensureRunning, sea } = vi.hoisted(() => ({
  ensureRunning: vi.fn(),
  sea: { bundled: false },
}));
vi.mock("node:sea", async (original) => ({
  ...(await original<typeof import("node:sea")>()),
  isSea: () => sea.bundled,
}));
vi.mock("@pe/host-contracts/pe-service", async (original) => ({
  ...(await original<typeof import("@pe/host-contracts/pe-service")>()),
  ensureRunning,
}));
const sourceRoot = checkoutRootFrom(import.meta.dirname)!;
const owner = sourceHostServiceName(sourceRoot);
let fixtureRoot: string;
let ownUrl: string;
function ownReceipt(port: number, patch: Record<string, unknown> = {}) {
  const receipt = {
    schemaVersion: 3,
    instanceId: "prompt-owner",
    processStartUtc: new Date().toISOString(),
    pid: process.pid,
    port,
    lane: "dev",
    version: "test",
    token: "fixture",
    sourceRoot,
    ...patch,
  };
  const file = serviceFilePath(productRoot(), owner);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(receipt));
  return receipt;
}

// A fake host harness wire: one thread whose append-only log the routes extend, streamed over SSE.
type Draft = Record<string, unknown> & { kind: HarnessEvent["kind"] };
const log: HarnessEvent[] = [];
const subscribers = new Set<ServerResponse>();
const calls: string[] = [];
const answers: string[] = [];
/** The content type of every non-GET request: the host refuses a body route without JSON. */
const contentTypes: (string | undefined)[] = [];
const runtimeOwners: (string | undefined)[] = [];
let turns = 0;
let servingOwner = owner;
let changeOwnerAfterProviders = false;

function append(...drafts: Draft[]): void {
  for (const draft of drafts) {
    const event = { seq: log.length + 1, at: new Date().toISOString(), ...draft } as HarnessEvent;
    log.push(event);
    for (const response of subscribers) response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

const chunk = (turnId: string, text: string): Draft => ({
  kind: "update",
  turnId,
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
});

const summary = (): HarnessThreadSummary => ({
  providerId: "codex",
  providerName: "Codex",
  head: { ...emptyThreadHead },
  lifecycle: emptyThreadLifecycle(),
  activity: { state: "idle", pending: 0, lastSeq: log.length, message: null },
  id: "t1",
  harness: "codex",
  title: "Pea prompt",
  createdAt: "",
  updatedAt: "",
  modelId: "body-model",
  lastSeq: log.length,
});

const server = createServer(async (request, response) => {
  let body = "";
  for await (const part of request) body += part;
  const url = new URL(request.url ?? "/", "http://fake");
  calls.push(`${request.method} ${url.pathname}`);
  runtimeOwners.push(request.headers["x-pe-runtime-service"] as string | undefined);
  if (request.method !== "GET") contentTypes.push(request.headers["content-type"]);
  const json = (value: unknown) => response.end(JSON.stringify(value));
  const route = `${request.method} ${url.pathname}`;
  if (request.headers["x-pe-runtime-service"] !== servingOwner) {
    response.statusCode = 403;
    return json({ refusal: { code: "runtime.owner-mismatch" } });
  }
  if (route === "GET /pe/providers") {
    if (changeOwnerAfterProviders) servingOwner = "foreign-checkout";
    return json([]);
  }
  if (route === "POST /pe/threads") return json(summary());
  if (route === "GET /pe/threads/t1")
    return json({
      ...summary(),
      events: log,
      models: [],
      traits: [],
      running: false,
      session: "started",
      promptCapabilities: null,
    });
  if (route === "POST /pe/threads/t1/model") {
    append({ kind: "model_changed", modelId: JSON.parse(body).modelId });
    return json(summary());
  }
  if (route === "POST /pe/threads/t1/cancel") return json({ cancelled: true });
  if (route === "POST /pe/threads/t1/prompt") {
    const turnId = `turn-${++turns}`;
    if (JSON.parse(body).text === "hang") {
      append({ kind: "prompt", turnId, text: "hang" });
      return json({ turnId });
    }
    if (JSON.parse(body).text === "ask") {
      append({ kind: "prompt", turnId, text: "ask" }, chunk(turnId, "Two decisions:"), {
        kind: "question_request",
        turnId,
        requestId: "q1",
        message: "Please answer the following questions.",
        requestedSchema: {
          type: "object",
          properties: {
            question_0: {
              title: "Mixing box",
              description: "How should it be modeled?",
              oneOf: [
                { const: "Nested", title: "Nested family", description: "schedulable" },
                { const: "Host" },
              ],
            },
            question_1: { description: "Which hand?" },
          },
        },
      });
      return json({ turnId });
    }
    append(
      { kind: "prompt", turnId, text: JSON.parse(body).text },
      chunk(turnId, "Hello"),
      { kind: "update", turnId: null, update: { sessionUpdate: "available_commands_update" } },
      { kind: "update", turnId, update: { sessionUpdate: "tool_call", toolCallId: "tc" } },
      chunk(turnId, "there"),
      {
        kind: "permission_request",
        turnId,
        requestId: `req-${turns}`,
        toolCall: { toolCallId: "tc", title: "Write file" },
        options: [
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    );
    return json({ turnId });
  }
  if (route === "POST /pe/threads/t1/permission") {
    const { requestId, optionId } = JSON.parse(body);
    answers.push(optionId);
    const turnId = `turn-${turns}`;
    append(
      { kind: "permission_resolved", turnId, requestId, optionId, by: "user" },
      chunk(turnId, " world"),
      { kind: "turn_end", turnId, stopReason: "end_turn" },
    );
    return json({ ok: true });
  }
  if (route === "GET /pe/threads/t1/stream") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const after = Number(url.searchParams.get("after"));
    for (const event of log.filter((candidate) => candidate.seq > after))
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    subscribers.add(response);
    response.on("close", () => subscribers.delete(response));
    return;
  }
  response.statusCode = 404;
  response.end(route);
});

const previousHost = process.env[hostProcessIdentity.hostBaseUrlVariable];
beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "pea-prompt-owner-"));
  vi.stubEnv("LOCALAPPDATA", fixtureRoot);
  vi.stubEnv("PE_LANE", "dev");
  vi.stubEnv("PE_TOOLS_SOURCE_ROOT", "");
  vi.stubEnv("PE_TOOLS_HOST_SERVICE_NAME", "");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  ownUrl = `http://127.0.0.1:${port}`;
  ownReceipt(port);
  process.env[hostProcessIdentity.hostBaseUrlVariable] = ownUrl;
});
afterAll(() => {
  if (previousHost === undefined) delete process.env[hostProcessIdentity.hostBaseUrlVariable];
  else process.env[hostProcessIdentity.hostBaseUrlVariable] = previousHost;
  server.closeAllConnections();
  server.close();
  vi.unstubAllEnvs();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test("foreign explicit host receives no providers, prompt or permission request", async () => {
  const foreignCalls: string[] = [];
  const foreign = createServer((request, response) => {
    foreignCalls.push(`${request.method} ${request.url}`);
    if (request.url === "/pe/providers") return response.end("[]");
    response.statusCode = 404;
    response.end("foreign inference ingress");
  });
  await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  const { port } = foreign.address() as AddressInfo;
  process.env[hostProcessIdentity.hostBaseUrlVariable] = `http://127.0.0.1:${port}`;
  try {
    await expect(
      runPeaPromptTurn({ prompt: "must never reach foreign inference", allow: true }),
    ).rejects.toThrow(/verified service/);
    expect(foreignCalls).toEqual([]);
    expect(ensureRunning).not.toHaveBeenCalled();
  } finally {
    process.env[hostProcessIdentity.hostBaseUrlVariable] = ownUrl;
    foreign.closeAllConnections();
    await new Promise<void>((resolve) => foreign.close(() => resolve()));
  }
});

test("pea --prompt creates a thread, rejects permissions by default, and continues with --allow", async () => {
  const first = await runPeaPromptTurn({ prompt: "hi", harness: "codex", modelId: "m1" });
  expect(first).toEqual({
    ok: true,
    host: process.env[hostProcessIdentity.hostBaseUrlVariable],
    threadId: "t1",
    harness: "codex",
    model: "m1",
    stopReason: "end_turn",
    response: "Hello\nthere world",
    rejected: ["Write file"],
  });
  expect(answers).toEqual(["reject"]);
  expect(calls).toContain("POST /pe/threads");

  // Continuing replays from the thread's last seq, so turn-1 text never leaks into turn-2.
  calls.length = 0;
  const second = await runPeaPromptTurn({ prompt: "again", threadId: "t1", allow: true });
  expect(second).toMatchObject({
    ok: true,
    threadId: "t1",
    response: "Hello\nthere world",
    rejected: [],
  });
  expect(answers).toEqual(["reject", "allow"]);
  expect(calls).not.toContain("POST /pe/threads");
  expect(calls).toContain("GET /pe/threads/t1");

  // A turn that outlives the timeout is cancelled; the body-less cancel still says JSON.
  calls.length = 0;
  const hung = await runPeaPromptTurn({ prompt: "hang", threadId: "t1", timeoutSeconds: 0.3 });
  expect(hung.stopReason).toBe("timeout");
  expect(calls).toContain("POST /pe/threads/t1/cancel");
  expect(contentTypes.every((type) => type === "application/json")).toBe(true);

  // A question card ends the headless turn with the questions as text; the next prompt answers.
  calls.length = 0;
  const asked = await runPeaPromptTurn({ prompt: "ask", threadId: "t1" });
  expect(asked.stopReason).toBe("question");
  expect(asked.response).toBe(
    [
      "Two decisions:",
      "",
      "Please answer the following questions.",
      "1. Mixing box: How should it be modeled?",
      "   - Nested family: schedulable",
      "   - Host",
      "2. Which hand?",
    ].join("\n"),
  );
  expect(calls).toContain("POST /pe/threads/t1/cancel");
  expect(runtimeOwners.length).toBeGreaterThan(0);
  expect(runtimeOwners.every((value) => value === owner)).toBe(true);
});

test("same-owner SDK startup ignores arbitrary launch command and revalidates its receipt", async () => {
  const port = (server.address() as AddressInfo).port;
  rmSync(serviceFilePath(productRoot(), owner));
  process.env[hostProcessIdentity.hostBaseUrlVariable] = "";
  process.env.PE_TOOLS_HOST_LAUNCH_COMMAND = "must-never-execute";
  ensureRunning.mockReset();
  ensureRunning.mockImplementationOnce(async () => ({ state: "started", file: ownReceipt(port) }));
  try {
    const result = await runPeaPromptTurn({ prompt: "hi", harness: "codex", allow: true });
    expect(result.ok).toBe(true);
    expect(ensureRunning).toHaveBeenCalledExactlyOnceWith(
      productRoot(),
      owner,
      expect.objectContaining({
        lane: "dev",
        matchSourceRoot: sourceRoot,
        spawnCommand: {
          command: "vp",
          args: ["run", "@pe/host#attach"],
          cwd: join(sourceRoot, "ts"),
          shell: true,
        },
      }),
    );
  } finally {
    delete process.env.PE_TOOLS_HOST_LAUNCH_COMMAND;
    process.env[hostProcessIdentity.hostBaseUrlVariable] = ownUrl;
    ownReceipt(port);
  }
});

test("foreign receipt refuses before SDK startup or any HTTP call", async () => {
  const port = (server.address() as AddressInfo).port;
  ownReceipt(port, { sourceRoot: join(fixtureRoot, "foreign") });
  const count = calls.length;
  ensureRunning.mockReset();
  try {
    await expect(runPeaPromptTurn({ prompt: "must not dispatch" })).rejects.toThrow(
      /Runtime checkout/,
    );
    expect(ensureRunning).not.toHaveBeenCalled();
    expect(calls).toHaveLength(count);
  } finally {
    ownReceipt(port);
  }
});

test("SDK acknowledgement with a foreign replacement receipt cannot authorize prompt requests", async () => {
  const port = (server.address() as AddressInfo).port;
  rmSync(serviceFilePath(productRoot(), owner));
  process.env[hostProcessIdentity.hostBaseUrlVariable] = "";
  ensureRunning.mockReset();
  ensureRunning.mockImplementationOnce(async () => ({
    state: "started",
    file: ownReceipt(port, { sourceRoot: join(fixtureRoot, "foreign") }),
  }));
  const count = calls.length;
  try {
    await expect(runPeaPromptTurn({ prompt: "must not dispatch" })).rejects.toThrow(
      /Runtime checkout/,
    );
    expect(ensureRunning).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(count);
  } finally {
    process.env[hostProcessIdentity.hostBaseUrlVariable] = ownUrl;
    ownReceipt(port);
  }
});

test("copied SEA pea is refused before SDK startup or prompt dispatch", async () => {
  const executable = process.execPath;
  const count = calls.length;
  sea.bundled = true;
  process.env.PE_LANE = "installed";
  process.execPath = join(fixtureRoot, "copied-pea.exe");
  ensureRunning.mockReset();
  try {
    await expect(runPeaPromptTurn({ prompt: "must not dispatch" })).rejects.toThrow(
      /Installed pea must execute/,
    );
    expect(ensureRunning).not.toHaveBeenCalled();
    expect(calls).toHaveLength(count);
  } finally {
    process.execPath = executable;
    sea.bundled = false;
    process.env.PE_LANE = "dev";
  }
});

test("same-address SDK acknowledgement must match the exact successor incarnation", async () => {
  const port = (server.address() as AddressInfo).port;
  rmSync(serviceFilePath(productRoot(), owner));
  process.env[hostProcessIdentity.hostBaseUrlVariable] = "";
  ensureRunning.mockReset();
  ensureRunning.mockImplementationOnce(async () => ({
    state: "started",
    file: { ...ownReceipt(port), instanceId: "other-incarnation" },
  }));
  const count = calls.length;
  try {
    await expect(runPeaPromptTurn({ prompt: "must not dispatch" })).rejects.toThrow(
      /acknowledgement disagrees/,
    );
    expect(calls).toHaveLength(count);
  } finally {
    process.env[hostProcessIdentity.hostBaseUrlVariable] = ownUrl;
    ownReceipt(port);
  }
});

test("same-address owner replacement receives the original owner label and refuses before inference", async () => {
  const offset = calls.length;
  const headerOffset = runtimeOwners.length;
  changeOwnerAfterProviders = true;
  try {
    await expect(runPeaPromptTurn({ prompt: "must not infer", allow: true })).rejects.toThrow(
      /403/,
    );
    expect(calls.slice(offset)).toEqual(["GET /pe/providers", "POST /pe/threads"]);
    expect(runtimeOwners.slice(headerOffset)).toEqual([owner, owner]);
  } finally {
    servingOwner = owner;
    changeOwnerAfterProviders = false;
  }
});

test("held prompt context retains owner labels and cannot bind a foreign address", async () => {
  const offset = runtimeOwners.length;
  const own = await withInvocationContext({ hostBaseUrl: ownUrl }, () =>
    runPeaPromptTurn({ prompt: "hi", allow: true }),
  );
  expect(own.ok).toBe(true);
  expect(runtimeOwners.slice(offset).every((value) => value === owner)).toBe(true);
  const count = calls.length;
  await expect(
    withInvocationContext({ hostBaseUrl: "http://127.0.0.1:1" }, () =>
      runPeaPromptTurn({ prompt: "must not dispatch" }),
    ),
  ).rejects.toThrow(/verified service/);
  expect(calls).toHaveLength(count);
});
