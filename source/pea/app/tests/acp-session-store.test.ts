import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  RequestPermissionRequest,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
  PeaAcpSessionStore,
  resolvePeaAcpRuntimeRequest,
} from "../acp/acp-session-store.js";
import type {
  PeaAnyRuntime,
  PeaRuntimeFactory,
} from "../pea-runtime-factory.js";
import type { PeaRuntimeEvent } from "../pea-runtime-events.js";
import { PeaRuntimeProtocolSessions } from "../pea-runtime-protocol-sessions.js";

describe("Pea ACP session store", () => {
  it("does not treat ACP cwd as the Pea workspace root", () => {
    const request = resolvePeaAcpRuntimeRequest(
      { runtime: "pea", workspaceKey: "runtime" },
      "C:/Users/kaitp/source/repos/Pe.Tools",
    );

    assert.equal(request.runtime, "pea");
    assert.equal(request.options.workspaceRoot, undefined);
    assert.equal(request.options.workspaceKey, "runtime");
  });

  it("keeps explicit Pea workspace root overrides", () => {
    const request = resolvePeaAcpRuntimeRequest(
      { runtime: "pea", workspaceRoot: "C:/Pea/ProductHome" },
      "C:/Users/kaitp/source/repos/Pe.Tools",
    );

    assert.equal(request.runtime, "pea");
    assert.equal(request.options.workspaceRoot, "C:/Pea/ProductHome");
  });

  it("uses ACP cwd as the peco workspace default", () => {
    const request = resolvePeaAcpRuntimeRequest(
      { runtime: "peco", modelId: "openai/gpt-5.5" },
      "C:/Users/kaitp/source/repos/Pe.Tools",
    );

    assert.equal(request.runtime, "peco");
    assert.equal(
      request.options.workspaceRoot,
      "C:/Users/kaitp/source/repos/Pe.Tools",
    );
    assert.equal(request.options.modelId, "openai/gpt-5.5");
  });

  it("requests ACP client permission for pending Pea runtime approval tools", async () => {
    const updates: SessionUpdate[] = [];
    const permissionRequests: RequestPermissionRequest[] = [];
    const sent: Array<{ resumeDecisions?: unknown }> = [];
    const runtimeSessions = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory(
        (listener) =>
          listener({
            type: "tool_started",
            toolCallId: "tool-1",
            toolName: "request_access",
            title: "Request Access",
            status: "pending_approval",
            input: { path: "C:/other", reason: "inspect requested files" },
          }),
        sent,
      ),
      sessionRegistryPath: null,
    });
    const store = new PeaAcpSessionStore(
      {
        async sessionUpdate(params) {
          updates.push(params.update);
        },
      },
      { runtime: "peco", runtimeSessions },
      {
        async requestPermission(params) {
          permissionRequests.push(params);
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      },
    );
    const session = await store.createSession({ cwd: "C:/repo" });

    await store.prompt(session.id, { content: "request access" });

    assert.equal(updates[0]?.sessionUpdate, "tool_call");
    assert.equal(updates[0]?.toolCallId, "tool-1");
    assert.equal(updates[0]?.status, "pending");
    assert.deepEqual(permissionRequests, [
      {
        sessionId: session.id,
        toolCall: {
          toolCallId: "tool-1",
          title: "Request Access",
          kind: "edit",
          status: "pending",
          rawInput: { path: "C:/other", reason: "inspect requested files" },
        },
        options: [
          {
            optionId: "allow_once",
            name: "Allow once",
            kind: "allow_once",
          },
          {
            optionId: "reject_once",
            name: "Reject once",
            kind: "reject_once",
          },
        ],
      },
    ]);
    assert.equal(updates[1]?.sessionUpdate, "tool_call_update");
    assert.deepEqual(updates[1]?.rawOutput, {
      permissionOutcome: { outcome: "selected", optionId: "allow_once" },
      resumeDecisionRecorded: true,
    });

    await store.prompt(session.id, { content: "continue" });

    assert.deepEqual(sent[1]?.resumeDecisions, [
      {
        interruptId: "tool-approval:tool-1",
        status: "resolved",
        payload: { optionId: "allow_once" },
      },
    ]);
  });

  it("deletes persisted ACP session metadata instead of only closing the active runtime", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-acp-session-store-"));
    const registryPath = path.join(temp, "sessions.json");
    try {
      const runtimeSessions = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(),
        sessionRegistryPath: registryPath,
      });
      const store = new PeaAcpSessionStore(
        { sessionUpdate() {} },
        { runtime: "peco", runtimeSessions },
      );
      const session = await store.createSession({ cwd: "C:/repo" });

      store.close(session.id);
      assert.equal(store.list("C:/repo")[0]?.sessionId, session.id);

      store.delete(session.id);
      assert.deepEqual(store.list("C:/repo"), []);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("loads persisted ACP session history and injects restored history into the fresh runtime thread", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-acp-load-session-"));
    const registryPath = path.join(temp, "sessions.json");
    try {
      const firstUpdates: SessionUpdate[] = [];
      const firstRuntimeSessions = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory((listener) =>
          listener({
            type: "assistant_message_delta",
            messageId: "assistant-1",
            delta: "loaded history",
          }),
        ),
        sessionRegistryPath: registryPath,
      });
      const firstStore = new PeaAcpSessionStore(
        {
          async sessionUpdate(params) {
            firstUpdates.push(params.update);
          },
        },
        { runtime: "peco", runtimeSessions: firstRuntimeSessions },
      );
      const session = await firstStore.createSession({ cwd: "C:/repo" });
      await firstStore.prompt(session.id, { content: "hello" });
      firstStore.close(session.id);

      assert.deepEqual(
        firstUpdates.map((update) => update.sessionUpdate),
        ["agent_message_chunk"],
      );

      const replayedUpdates: SessionUpdate[] = [];
      const sent: Array<{
        context?: Array<{ description: string; value: string }>;
      }> = [];
      const secondRuntimeSessions = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(undefined, sent),
        sessionRegistryPath: registryPath,
      });
      const secondStore = new PeaAcpSessionStore(
        {
          async sessionUpdate(params) {
            replayedUpdates.push(params.update);
          },
        },
        { runtime: "peco", runtimeSessions: secondRuntimeSessions },
      );

      await secondStore.load({ sessionId: session.id, cwd: "C:/repo" });

      assert.deepEqual(
        replayedUpdates.map((update) => update.sessionUpdate),
        ["user_message_chunk", "agent_message_chunk"],
      );
      assert.deepEqual(replayedUpdates[0], {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "hello" },
      });
      assert.deepEqual(replayedUpdates[1], {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-1",
        content: { type: "text", text: "loaded history" },
      });

      await secondStore.prompt(session.id, { content: "next" });
      const restoredHistory = sent[0]?.context?.find(
        (entry) =>
          entry.description === "Pea restored protocol session history",
      );
      assert.ok(restoredHistory);
      assert.match(restoredHistory.value, /loaded history/);
      assert.match(restoredHistory.value, /hello/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("forks ACP sessions by copying Pea-owned protocol history", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-acp-fork-session-"));
    const registryPath = path.join(temp, "sessions.json");
    try {
      const firstRuntimeSessions = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory((listener) =>
          listener({
            type: "assistant_message_delta",
            messageId: "assistant-1",
            delta: "fork me",
          }),
        ),
        sessionRegistryPath: registryPath,
      });
      const firstStore = new PeaAcpSessionStore(
        { sessionUpdate() {} },
        { runtime: "peco", runtimeSessions: firstRuntimeSessions },
      );
      const source = await firstStore.createSession({ cwd: "C:/repo" });
      await firstStore.prompt(source.id, { content: "hello" });
      firstStore.close(source.id);

      const sent: Array<{
        context?: Array<{ description: string; value: string }>;
      }> = [];
      const secondRuntimeSessions = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(undefined, sent),
        sessionRegistryPath: registryPath,
      });
      const secondStore = new PeaAcpSessionStore(
        { sessionUpdate() {} },
        { runtime: "peco", runtimeSessions: secondRuntimeSessions },
      );

      const fork = await secondStore.fork({
        sessionId: source.id,
        cwd: "C:/repo",
        additionalDirectories: ["C:/fork"],
      });

      assert.equal(fork.id, "test-2");
      assert.deepEqual(fork.additionalDirectories, ["C:\\fork"]);
      await secondStore.prompt(fork.id, { content: "next" });
      const restoredHistory = sent[0]?.context?.find(
        (entry) =>
          entry.description === "Pea restored protocol session history",
      );
      assert.ok(restoredHistory);
      assert.match(restoredHistory.value, /hello/);
      assert.match(restoredHistory.value, /fork me/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

function fakeFactory(
  onSend?: (listener: (event: PeaRuntimeEvent) => void) => void,
  sent: unknown[] = [],
): PeaRuntimeFactory {
  const listeners: Array<(event: PeaRuntimeEvent) => void> = [];
  return {
    runtimeId: "peco",
    async create(request) {
      return {
        runtimeId: "peco",
        workspace: {
          cwd: request.cwd ?? "C:/repo",
          projectRoot: request.cwd ?? "C:/repo",
          hostBaseUrl: "http://127.0.0.1",
          workspaceKey: "default",
        },
        sessions: {
          async createThreadSession() {
            return { threadId: "thread-1", resourceId: "resource-1" };
          },
          async switchThread() {},
          async sendMessage(message: unknown) {
            sent.push(message);
            for (const listener of listeners) onSend?.(listener);
          },
          abort() {},
          subscribe(listener: (event: PeaRuntimeEvent) => void) {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
        },
      } as unknown as PeaAnyRuntime;
    },
  };
}
