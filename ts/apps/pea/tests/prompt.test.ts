import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { HarnessEvent } from "@pe/agent-contracts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { runPeaPromptTurn } from "../src/prompt.ts";

// A fake host harness wire: one thread whose append-only log the routes extend, streamed over SSE.
type Draft = Record<string, unknown> & { kind: HarnessEvent["kind"] };
const log: HarnessEvent[] = [];
const subscribers = new Set<ServerResponse>();
const calls: string[] = [];
const answers: string[] = [];
/** The content type of every non-GET request: the host refuses a body route without JSON. */
const contentTypes: (string | undefined)[] = [];
let turns = 0;

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

const summary = () => ({
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
  if (request.method !== "GET") contentTypes.push(request.headers["content-type"]);
  const json = (value: unknown) => response.end(JSON.stringify(value));
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /pe/harnesses") return json([]);
  if (route === "POST /pe/threads") return json(summary());
  if (route === "GET /pe/threads/t1") return json({ ...summary(), events: log });
  if (route === "POST /pe/threads/t1/model") {
    append({ kind: "model_changed", modelId: JSON.parse(body).modelId });
    return json({});
  }
  if (route === "POST /pe/threads/t1/cancel") return json({ cancelled: true });
  if (route === "POST /pe/threads/t1/prompt") {
    const turnId = `turn-${++turns}`;
    if (JSON.parse(body).text === "hang") {
      append({ kind: "prompt", turnId, text: "hang" });
      return json({ turnId });
    }
    append(
      { kind: "prompt", turnId, text: JSON.parse(body).text },
      { kind: "queued", turnId: "turn-q", text: "later" },
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
    return json({});
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env[hostProcessIdentity.hostBaseUrlVariable] = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  if (previousHost === undefined) delete process.env[hostProcessIdentity.hostBaseUrlVariable];
  else process.env[hostProcessIdentity.hostBaseUrlVariable] = previousHost;
  server.closeAllConnections();
  server.close();
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
});
