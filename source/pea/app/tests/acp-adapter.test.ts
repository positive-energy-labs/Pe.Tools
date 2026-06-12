import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PeaAcpAgent,
  acpPrompt,
  promptText,
  type PeaAcpAgentSessionStore,
} from "../acp/pea-acp-adapter.js";
import type { AcpSession } from "../acp/acp-session-store.js";
import type { SessionId } from "@agentclientprotocol/sdk";
import type { PeaRuntimePrompt } from "../pea-runtime-prompts.js";

describe("Pea ACP adapter", () => {
  it("advertises runtime identity and close-session support", async () => {
    const agent = new PeaAcpAgent({ runtime: "peco" }, fakeSessionStore());

    const response = await agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });

    assert.equal(response.protocolVersion, 1);
    assert.equal(response.agentInfo?.name, "Pe.Tools peco");
    assert.deepEqual(response.authMethods, [
      {
        type: "env_var",
        id: "openai-api-key",
        name: "OpenAI API key",
        description:
          "Use OPENAI_API_KEY or stored MastraCode API-key credentials for Pea runtime model access.",
        vars: [
          {
            name: "OPENAI_API_KEY",
            label: "OpenAI API key",
            secret: true,
            optional: false,
          },
        ],
      },
    ]);
    assert.deepEqual(response.agentCapabilities?.auth, {});
    assert.equal(response.agentCapabilities?.auth?.logout, undefined);
    assert.equal(response.agentCapabilities?.loadSession, true);
    assert.deepEqual(
      response.agentCapabilities?.sessionCapabilities?.additionalDirectories,
      {},
    );
    assert.deepEqual(
      response.agentCapabilities?.sessionCapabilities?.close,
      {},
    );
    assert.deepEqual(response.agentCapabilities?.sessionCapabilities?.list, {});
    assert.deepEqual(
      response.agentCapabilities?.sessionCapabilities?.resume,
      {},
    );
    assert.deepEqual(
      response.agentCapabilities?.sessionCapabilities?.delete,
      {},
    );
    assert.deepEqual(response.agentCapabilities?.sessionCapabilities?.fork, {});
    assert.equal(
      response.agentCapabilities?.promptCapabilities?.embeddedContext,
      true,
    );
  });

  it("advertises OAuth when selected and validates ACP authenticate method ids", async () => {
    const agent = new PeaAcpAgent(
      { runtime: "peco", authSource: "oauth" },
      fakeSessionStore(),
    );
    const response = await agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });

    assert.deepEqual(response.authMethods, [
      {
        id: "codex-oauth",
        name: "Codex OAuth",
        description:
          "Use the runtime-managed Codex OAuth credential already stored for the Pea/peco process.",
      },
    ]);
    assert.deepEqual(await agent.authenticate({ methodId: "codex-oauth" }), {});
    await assert.rejects(
      () => agent.authenticate({ methodId: "unknown" }),
      /Unsupported Pea runtime auth method/,
    );
  });

  it("advertises scoped logout for the Pea runtime", async () => {
    const agent = new PeaAcpAgent({ runtime: "pea" }, fakeSessionStore());
    const response = await agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });

    assert.deepEqual(response.agentCapabilities?.auth?.logout, {});
  });

  it("creates sessions with runtime modes and forwards prompts", async () => {
    const prompts: Array<{ sessionId: SessionId; prompt: PeaRuntimePrompt }> =
      [];
    const createRequests: Array<{
      cwd: string;
      additionalDirectories?: string[];
    }> = [];
    const store = fakeSessionStore({
      async createSession(request) {
        createRequests.push(request);
        return {
          id: "session-1",
          cwd: request.cwd,
          threadId: "thread-1",
        } as unknown as AcpSession;
      },
      async prompt(sessionId, prompt) {
        prompts.push({ sessionId, prompt });
        return "end_turn";
      },
    });
    const agent = new PeaAcpAgent({ runtime: "pea" }, store);

    const session = await agent.newSession({
      cwd: "C:/repo",
      mcpServers: [],
      additionalDirectories: ["C:/shared"],
    });
    assert.equal(session.sessionId, "session-1");
    assert.equal(session.modes?.currentModeId, "pea");
    assert.equal(session.modes?.availableModes[0]?.name, "Pea");
    assert.deepEqual(createRequests, [
      { cwd: "C:/repo", additionalDirectories: ["C:/shared"] },
    ]);

    const prompt = await agent.prompt({
      sessionId: "session-1",
      prompt: [
        { type: "text", text: "inspect this" },
        {
          type: "resource_link",
          uri: "file:///C:/repo/README.md",
          name: "README.md",
        },
      ],
    });

    assert.equal(prompt.stopReason, "end_turn");
    assert.deepEqual(prompts, [
      {
        sessionId: "session-1",
        prompt: {
          content:
            "inspect this\n\nResource: README.md\nfile:///C:/repo/README.md",
          resources: [
            {
              id: "acp:1:resource-link",
              protocol: "acp",
              kind: "link",
              uri: "file:///C:/repo/README.md",
              name: "README.md",
              title: "README.md",
            },
          ],
        },
      },
    ]);
  });

  it("routes cancel and close to the session store", async () => {
    const cancelled: SessionId[] = [];
    const closed: SessionId[] = [];
    const agent = new PeaAcpAgent(
      { runtime: "peco" },
      fakeSessionStore({
        cancel(sessionId) {
          cancelled.push(sessionId);
        },
        close(sessionId) {
          closed.push(sessionId);
        },
      }),
    );

    await agent.cancel({ sessionId: "session-1" });
    await agent.closeSession?.({ sessionId: "session-1" });

    assert.deepEqual(cancelled, ["session-1"]);
    assert.deepEqual(closed, ["session-1"]);
  });

  it("formats ACP content blocks into a runtime prompt with embedded resource context", () => {
    assert.equal(
      promptText([
        { type: "text", text: "hello" },
        { type: "resource", resource: { uri: "file:///tmp/a.txt", text: "A" } },
      ]),
      "hello\n\nEmbedded resource: file:///tmp/a.txt",
    );
    assert.deepEqual(
      acpPrompt([
        { type: "text", text: "hello" },
        { type: "resource", resource: { uri: "file:///tmp/a.txt", text: "A" } },
      ]).resources,
      [
        {
          id: "acp:1:resource",
          protocol: "acp",
          kind: "embedded",
          uri: "file:///tmp/a.txt",
          text: "A",
        },
      ],
    );
  });

  it("lists, resumes and deletes active sessions through the session store", async () => {
    const deleted: SessionId[] = [];
    const resumed: Array<{
      sessionId: SessionId;
      cwd?: string;
      additionalDirectories?: string[];
    }> = [];
    const agent = new PeaAcpAgent(
      { runtime: "peco" },
      fakeSessionStore({
        async resume(request) {
          resumed.push(request);
          return {
            id: request.sessionId,
            cwd: request.cwd ?? "C:/repo",
            threadId: "thread-1",
          } as unknown as AcpSession;
        },
        list() {
          return [
            { sessionId: "session-1", cwd: "C:/repo", title: "ACP peco" },
          ];
        },
        delete(sessionId) {
          deleted.push(sessionId);
        },
      }),
    );

    const list = await agent.listSessions?.({ cwd: "C:/repo" });
    assert.deepEqual(list?.sessions, [
      { sessionId: "session-1", cwd: "C:/repo", title: "ACP peco" },
    ]);

    const resume = await agent.resumeSession?.({
      sessionId: "session-1",
      cwd: "C:/repo",
      additionalDirectories: ["C:/shared"],
      mcpServers: [],
    });
    assert.equal(resume?.modes?.currentModeId, "peco");
    assert.deepEqual(resumed, [
      {
        sessionId: "session-1",
        cwd: "C:/repo",
        additionalDirectories: ["C:/shared"],
      },
    ]);

    await agent.deleteSession?.({ sessionId: "session-1" });
    assert.deepEqual(deleted, ["session-1"]);
  });

  it("loads sessions through the session store", async () => {
    const loaded: Array<{
      sessionId: SessionId;
      cwd: string;
      additionalDirectories?: string[];
    }> = [];
    const agent = new PeaAcpAgent(
      { runtime: "peco" },
      fakeSessionStore({
        async load(request) {
          loaded.push(request);
          return {
            id: request.sessionId,
            cwd: request.cwd,
            threadId: "thread-1",
          } as unknown as AcpSession;
        },
      }),
    );

    const response = await agent.loadSession?.({
      sessionId: "session-1",
      cwd: "C:/repo",
      additionalDirectories: ["C:/shared"],
      mcpServers: [],
    });

    assert.equal(response?.modes?.currentModeId, "peco");
    assert.deepEqual(loaded, [
      {
        sessionId: "session-1",
        cwd: "C:/repo",
        additionalDirectories: ["C:/shared"],
      },
    ]);
  });

  it("forks sessions through the session store", async () => {
    const forked: Array<{
      sessionId: SessionId;
      cwd: string;
      additionalDirectories?: string[];
    }> = [];
    const agent = new PeaAcpAgent(
      { runtime: "peco" },
      fakeSessionStore({
        async fork(request) {
          forked.push(request);
          return {
            id: "session-2",
            cwd: request.cwd,
            threadId: "thread-2",
          } as unknown as AcpSession;
        },
      }),
    );

    const response = await agent.unstable_forkSession?.({
      sessionId: "session-1",
      cwd: "C:/repo",
      additionalDirectories: ["C:/fork"],
      mcpServers: [],
    });

    assert.equal(response?.sessionId, "session-2");
    assert.equal(response?.modes?.currentModeId, "peco");
    assert.deepEqual(forked, [
      {
        sessionId: "session-1",
        cwd: "C:/repo",
        additionalDirectories: ["C:/fork"],
      },
    ]);
  });
});

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
