import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionId } from "@agentclientprotocol/sdk";
import { PeaAcpHttpAgent } from "../acp/pea-acp-http-agent.js";
import type { PeaAcpAgentSessionStore } from "../acp/pea-acp-adapter.js";
import type { AcpSession } from "../acp/acp-session-store.js";
import type { PeaRuntimePrompt } from "../pea-runtime-prompts.js";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

describe("ACP HTTP agent", () => {
  it("rejects missing or invalid tokens", async () => {
    const agent = new PeaAcpHttpAgent({
      runtime: "dev-agent",
      port: 0,
      token: "secret",
      sessionStore: fakeSessionStore(),
    });
    const info = await agent.start();
    try {
      assert.equal((await fetch(`http://${info.host}:${info.port}/status`)).status, 401);
      assert.equal(
        (await fetch(`http://${info.host}:${info.port}/status?token=wrong`)).status,
        401,
      );
      assert.equal(
        (await fetch(`http://${info.host}:${info.port}/status?token=secret`)).status,
        200,
      );
      assert.equal(info.statusUrl, `http://${info.host}:${info.port}/status?token=secret`);
    } finally {
      await agent.close();
    }
  });

  it("serves Pea runtime protocol status for ACP HTTP discovery", async () => {
    const agent = new PeaAcpHttpAgent({
      runtime: "pea",
      port: 0,
      token: "secret",
      sessionStore: fakeSessionStore({
        list() {
          return [{ sessionId: "session-1", cwd: "C:/repo" } as any];
        },
      }),
    });
    const info = await agent.start();

    try {
      const response = await fetch(info.statusUrl);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.status, "ok");
      assert.equal(status.runtime, "pea");
      assert.equal(status.protocol, "acp");
      assert.equal(status.transport, "http+sse");
      assert.equal(status.runtimeInfo.name, "Pea");
      assert.equal(status.auth.source, "api-key");
      assert.equal(status.auth.logoutSupported, true);
      assert.equal(status.auth.methods[0].id, "openai-api-key");
      assert.equal(status.sessions, 1);
    } finally {
      await agent.close();
    }
  });

  it("routes JSON-RPC requests through the SDK-backed ACP adapter", async () => {
    const prompts: Array<{ sessionId: SessionId; prompt: PeaRuntimePrompt }> = [];
    const agent = new PeaAcpHttpAgent({
      runtime: "dev-agent",
      port: 0,
      token: "secret",
      sessionStore: fakeSessionStore({
        async prompt(sessionId, prompt) {
          prompts.push({ sessionId, prompt });
          return "end_turn";
        },
      }),
    });
    const info = await agent.start();
    const events = await fetch(info.eventsUrl);
    const reader = events.body?.getReader();
    assert.ok(reader);

    try {
      assert.equal((await postJson(info.rpcUrl, initializeRequest())).accepted, true);
      const initialize = await readNextJsonRpc(reader, 1);
      assert.equal(initialize.result?.agentInfo?.name, "Pe.Tools dev-agent");
      assert.equal(initialize.result?.authMethods?.[0]?.id, "openai-api-key");
      assert.equal(initialize.result?.agentCapabilities?.auth?.logout, undefined);
      assert.equal(initialize.result?.agentCapabilities?.loadSession, true);
      assert.deepEqual(
        initialize.result?.agentCapabilities?.sessionCapabilities?.additionalDirectories,
        {},
      );
      assert.deepEqual(initialize.result?.agentCapabilities?.sessionCapabilities?.close, {});
      assert.deepEqual(initialize.result?.agentCapabilities?.sessionCapabilities?.fork, {});
      assert.deepEqual(initialize.result?.agentCapabilities?.sessionCapabilities?.list, {});
      assert.equal(initialize.result?.agentCapabilities?.promptCapabilities?.embeddedContext, true);

      await postJson(info.rpcUrl, {
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "C:/repo", mcpServers: [] },
      });
      const session = await readNextJsonRpc(reader, 2);
      assert.equal(session.result?.sessionId, "session-1");
      assert.equal(session.result?.modes?.currentModeId, "dev-agent");
      const statusAfterSession = await fetch(info.statusUrl);
      assert.equal((await statusAfterSession.json()).sessions, 1);

      await postJson(info.rpcUrl, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          prompt: [
            { type: "text", text: "hello" },
            { type: "resource_link", uri: "file:///C:/repo/README.md", name: "README.md" },
          ],
        },
      });
      const prompt = await readNextJsonRpc(reader, 3);
      assert.deepEqual(prompt.result, { stopReason: "end_turn" });
      assert.equal(prompts[0]?.sessionId, "session-1");
      assert.equal(
        prompts[0]?.prompt.content,
        "hello\n\nResource: README.md\nfile:///C:/repo/README.md",
      );
      assert.deepEqual(prompts[0]?.prompt.resources?.[0], {
        id: "acp:1:resource-link",
        protocol: "acp",
        kind: "link",
        uri: "file:///C:/repo/README.md",
        name: "README.md",
        title: "README.md",
      });
    } finally {
      await reader.cancel().catch(() => undefined);
      await agent.close();
    }
  });

  it("closes retained ACP runtime sessions when the HTTP transport shuts down", async () => {
    let closeAllCalls = 0;
    const agent = new PeaAcpHttpAgent({
      runtime: "dev-agent",
      port: 0,
      token: "secret",
      sessionStore: fakeSessionStore({
        closeAll() {
          closeAllCalls += 1;
        },
      }),
    });

    await agent.start();
    await agent.close();

    assert.equal(closeAllCalls, 1);
  });
});

function fakeSessionStore(
  overrides: Partial<PeaAcpAgentSessionStore> = {},
): PeaAcpAgentSessionStore {
  const sessions: Array<{ sessionId: string; cwd: string; additionalDirectories?: string[] }> = [];
  return {
    async createSession(request) {
      sessions.push({
        sessionId: "session-1",
        cwd: request.cwd,
        additionalDirectories: request.additionalDirectories,
      });
      return { id: "session-1", cwd: request.cwd, threadId: "thread-1" } as unknown as AcpSession;
    },
    async prompt() {
      return "end_turn";
    },
    cancel() {},
    async resume() {
      return { id: "session-1", cwd: "C:/repo", threadId: "thread-1" } as unknown as AcpSession;
    },
    async load() {
      return { id: "session-1", cwd: "C:/repo", threadId: "thread-1" } as unknown as AcpSession;
    },
    async fork() {
      return { id: "session-2", cwd: "C:/repo", threadId: "thread-2" } as unknown as AcpSession;
    },
    list() {
      return sessions as any;
    },
    delete(sessionId) {
      const index = sessions.findIndex((session) => session.sessionId === sessionId);
      if (index >= 0) sessions.splice(index, 1);
    },
    close(sessionId) {
      const index = sessions.findIndex((session) => session.sessionId === sessionId);
      if (index >= 0) sessions.splice(index, 1);
    },
    ...overrides,
  };
}

function initializeRequest(): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    },
  };
}

async function postJson(url: string, value: unknown): Promise<{ accepted: boolean }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (response.status !== 202) assert.fail(await response.text());
  return (await response.json()) as { accepted: boolean };
}

async function readNextJsonRpc(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  id: number,
): Promise<any> {
  while (true) {
    const message = await readFirstSseEvent(reader);
    if (message.id === id) return message;
  }
}

async function readFirstSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<JsonRpcMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    while (!buffer.includes("\n\n")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += decoder.decode(chunk.value, { stream: true });
    }

    const frameEnd = buffer.indexOf("\n\n");
    const frame = buffer.slice(0, frameEnd);
    buffer = buffer.slice(frameEnd + 2);
    const match = /^data: (.+)$/m.exec(frame);
    if (match) return JSON.parse(match[1]!) as JsonRpcMessage;
  }
}
