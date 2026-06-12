import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentSideConnection,
  ClientSideConnection,
  type Client,
  type SessionId,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import {
  PeaAcpAgent,
  type PeaAcpAgentSessionStore,
} from "../acp/pea-acp-adapter.js";
import { PeaAcpHttpAgent } from "../acp/pea-acp-http-agent.js";
import type { AcpSession, PeaAcpRuntimeId } from "../acp/acp-session-store.js";
import type { PeaRuntimePrompt } from "../pea-runtime-prompts.js";

type AnyMessage = Parameters<WritableStreamDefaultWriter["write"]>[0];

const runtimes: PeaAcpRuntimeId[] = ["pea", "peco"];

describe("ACP SDK end-to-end", () => {
  for (const runtime of runtimes) {
    it(`handshakes and runs a session over stdio-shaped streams for ${runtime}`, async () => {
      const prompts: Array<{ sessionId: SessionId; prompt: PeaRuntimePrompt }> =
        [];
      const pair = createStreamPair();
      const agentConnection = new AgentSideConnection(
        () =>
          new PeaAcpAgent(
            { runtime },
            fakeSessionStore({
              async prompt(sessionId, prompt) {
                prompts.push({ sessionId, prompt });
                return "end_turn";
              },
            }),
          ),
        pair.agent,
      );
      const clientConnection = new ClientSideConnection(
        () => fakeClient(),
        pair.client,
      );

      try {
        await assertSdkSession(clientConnection, runtime, prompts);
      } finally {
        await pair.close();
        await Promise.all([agentConnection.closed, clientConnection.closed]);
      }
    });

    it(`handshakes and runs a session over HTTP/SSE for ${runtime}`, async () => {
      const prompts: Array<{ sessionId: SessionId; prompt: PeaRuntimePrompt }> =
        [];
      const agent = new PeaAcpHttpAgent({
        runtime,
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
      const httpStream = createHttpAcpClientStream(info.rpcUrl, info.eventsUrl);
      const clientConnection = new ClientSideConnection(
        () => fakeClient(),
        httpStream.stream,
      );

      try {
        await assertSdkSession(clientConnection, runtime, prompts);
      } finally {
        await httpStream.close();
        await agent.close();
      }
    });
  }
});

async function assertSdkSession(
  connection: ClientSideConnection,
  runtime: PeaAcpRuntimeId,
  prompts: Array<{ sessionId: SessionId; prompt: PeaRuntimePrompt }>,
): Promise<void> {
  const initialized = await connection.initialize({
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "sdk-e2e-test", version: "0.0.0" },
  });
  assert.equal(initialized.protocolVersion, 1);
  assert.equal(
    initialized.agentInfo?.name,
    runtime === "peco" ? "Pe.Tools peco" : "Pea",
  );
  assert.equal(initialized.authMethods?.[0]?.id, "openai-api-key");
  if (runtime === "pea") {
    assert.deepEqual(initialized.agentCapabilities?.auth?.logout, {});
  } else {
    assert.equal(initialized.agentCapabilities?.auth?.logout, undefined);
  }
  assert.equal(initialized.agentCapabilities?.loadSession, true);
  assert.deepEqual(
    initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories,
    {},
  );
  assert.deepEqual(
    initialized.agentCapabilities?.sessionCapabilities?.close,
    {},
  );
  assert.deepEqual(
    initialized.agentCapabilities?.sessionCapabilities?.fork,
    {},
  );
  assert.deepEqual(
    initialized.agentCapabilities?.sessionCapabilities?.list,
    {},
  );
  assert.deepEqual(
    initialized.agentCapabilities?.sessionCapabilities?.resume,
    {},
  );

  const session = await connection.newSession({
    cwd: "C:/repo",
    mcpServers: [],
  });
  assert.equal(session.sessionId, "session-1");
  assert.equal(session.modes?.currentModeId, runtime);
  assert.equal(session.modes?.availableModes[0]?.id, runtime);

  const prompt = await connection.prompt({
    sessionId: session.sessionId,
    prompt: [
      { type: "text", text: "hello" },
      {
        type: "resource_link",
        uri: "file:///C:/repo/README.md",
        name: "README.md",
      },
    ],
  });
  assert.deepEqual(prompt, { stopReason: "end_turn" });
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
}

function createStreamPair(): {
  client: Stream;
  agent: Stream;
  close(): Promise<void>;
} {
  const clientToAgent = createMessageChannel();
  const agentToClient = createMessageChannel();
  return {
    client: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
    agent: {
      readable: clientToAgent.readable,
      writable: agentToClient.writable,
    },
    async close() {
      await Promise.allSettled([clientToAgent.close(), agentToClient.close()]);
    },
  };
}

function createMessageChannel(): {
  readable: ReadableStream<AnyMessage>;
  writable: WritableStream<AnyMessage>;
  close(): Promise<void>;
} {
  let controller: ReadableStreamDefaultController<AnyMessage> | null = null;
  const readable = new ReadableStream<AnyMessage>({
    start(nextController) {
      controller = nextController;
    },
  });
  const writable = new WritableStream<AnyMessage>({
    write(message) {
      controller?.enqueue(message);
    },
    close() {
      controller?.close();
    },
  });
  return {
    readable,
    writable,
    async close() {
      await writable.close().catch(() => undefined);
    },
  };
}

function createHttpAcpClientStream(
  rpcUrl: string,
  eventsUrl: string,
): { stream: Stream; close(): Promise<void> } {
  const abortController = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      const response = await fetch(eventsUrl, {
        signal: abortController.signal,
      });
      reader = response.body?.getReader() ?? null;
      if (!reader)
        throw new Error("ACP HTTP events response did not include a body.");

      const decoder = new TextDecoder();
      let buffer = "";
      while (!abortController.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        while (buffer.includes("\n\n")) {
          const frameEnd = buffer.indexOf("\n\n");
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const match = /^data: (.+)$/m.exec(frame);
          if (match) controller.enqueue(JSON.parse(match[1]!) as AnyMessage);
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (response.status !== 202) throw new Error(await response.text());
    },
    close() {
      abortController.abort();
    },
  });

  return {
    stream: { readable, writable },
    async close() {
      abortController.abort();
      await reader?.cancel().catch(() => undefined);
    },
  };
}

function fakeClient(): Client {
  return {
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate(_params: SessionNotification) {},
  };
}

function fakeSessionStore(
  overrides: Partial<PeaAcpAgentSessionStore> = {},
): PeaAcpAgentSessionStore {
  return {
    async createSession(request) {
      return {
        id: "session-1",
        cwd: request.cwd,
        threadId: "thread-1",
      } as unknown as AcpSession;
    },
    async prompt() {
      return "end_turn";
    },
    cancel() {},
    async resume() {
      return {
        id: "session-1",
        cwd: "C:/repo",
        threadId: "thread-1",
      } as unknown as AcpSession;
    },
    async load() {
      return {
        id: "session-1",
        cwd: "C:/repo",
        threadId: "thread-1",
      } as unknown as AcpSession;
    },
    async fork() {
      return {
        id: "session-2",
        cwd: "C:/repo",
        threadId: "thread-2",
      } as unknown as AcpSession;
    },
    list() {
      return [];
    },
    delete() {},
    close() {},
    ...overrides,
  };
}
