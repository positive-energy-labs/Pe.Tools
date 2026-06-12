import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  PeaAnyRuntime,
  PeaRuntimeFactory,
} from "../pea-runtime-factory.js";
import { PeaRuntimeProtocolSessions } from "../pea-runtime-protocol-sessions.js";

describe("Pea runtime protocol sessions", () => {
  it("creates stable Pea-owned sessions for protocol thread ids", async () => {
    const calls: string[] = [];
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory(calls),
    });

    const first = await manager.getOrCreateThreadSession({
      protocol: "ag-ui",
      externalThreadId: "thread-a",
      cwd: "C:/repo",
      additionalDirectories: ["C:/repo", "C:/shared", "C:/shared"],
      title: "AG-UI thread-a",
    });
    const second = await manager.getOrCreateThreadSession({
      protocol: "ag-ui",
      externalThreadId: "thread-a",
      cwd: "C:/repo",
      title: "AG-UI thread-a",
    });

    assert.equal(first, second);
    assert.equal(first.id, "test-1");
    assert.equal(first.threadId, "thread-1");
    assert.equal(first.resourceId, "resource-1");
    assert.deepEqual(first.additionalDirectories, ["C:\\repo", "C:\\shared"]);
    assert.deepEqual(calls, [
      "createRuntime:C:\\repo:ag-ui",
      "createThread:AG-UI thread-a",
    ]);
  });

  it("switches to the stored runtime thread before every prompt", async () => {
    const calls: string[] = [];
    const sent: unknown[] = [];
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory(calls, sent),
    });
    const session = await manager.createSession({
      protocol: "acp",
      cwd: "C:/repo",
      title: "ACP peco",
    });

    const stopReason = await manager.sendPrompt(session.id, {
      content: "inspect",
      context: [{ description: "Source", value: "ACP" }],
    });

    assert.equal(stopReason, "end_turn");
    assert.deepEqual(calls, [
      "createRuntime:C:\\repo:acp",
      "createThread:ACP peco",
      "switch:thread-1",
      "send:inspect:acp",
    ]);
    assert.deepEqual(sent, [
      {
        content: "inspect",
        context: [{ description: "Source", value: "ACP" }],
        protocol: "acp",
        protocolSessionId: "test-1",
      },
    ]);
  });

  it("adds session resource scope and scoped prompt resources to runtime context", async () => {
    const sent: Array<{
      content: string;
      context?: Array<{ description: string; value: string }>;
      client?: unknown;
      protocol?: string;
    }> = [];
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory([], sent),
    });
    const session = await manager.createSession({
      protocol: "acp",
      cwd: "C:/repo",
      additionalDirectories: ["C:/shared"],
      title: "ACP peco",
    });

    await manager.sendPrompt(session.id, {
      content: "inspect",
      resources: [
        {
          id: "resource-1",
          protocol: "acp",
          kind: "link",
          uri: "file:///C:/shared/docs/spec.md",
          title: "spec.md",
        },
      ],
    });

    assert.equal(
      sent[0]?.context?.[0]?.description,
      "Pea runtime resource scope",
    );
    assert.deepEqual(JSON.parse(sent[0]?.context?.[0]?.value ?? "{}"), {
      cwd: "C:\\repo",
      additionalDirectories: ["C:\\shared"],
    });
    assert.equal(
      sent[0]?.context?.[1]?.description,
      "Pea runtime resource: spec.md",
    );
    assert.deepEqual(JSON.parse(sent[0]?.context?.[1]?.value ?? "{}"), {
      id: "resource-1",
      kind: "link",
      protocol: "acp",
      uri: "file:///C:/shared/docs/spec.md",
      title: "spec.md",
      path: "C:\\shared\\docs\\spec.md",
      inScope: true,
    });
  });

  it("adds resume decisions to runtime context through the session seam", async () => {
    const sent: Array<{
      context?: Array<{ description: string; value: string }>;
      resumeDecisions?: unknown;
    }> = [];
    const resumeDecisions = [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved" as const,
        payload: { approved: true },
      },
    ];
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory([], sent),
    });
    const session = await manager.createSession({
      protocol: "ag-ui",
      cwd: "C:/repo",
      title: "AG-UI ag-thread-1",
    });

    await manager.sendPrompt(session.id, {
      content: "continue",
      resumeDecisions,
    });

    assert.deepEqual(sent[0]?.resumeDecisions, resumeDecisions);
    const resumeEntry = sent[0]?.context?.find(
      (entry) => entry.description === "Pea runtime resume decisions",
    );
    assert.ok(resumeEntry);
    assert.deepEqual(JSON.parse(resumeEntry.value), [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved",
        payload: { approved: true },
      },
    ]);
  });

  it("persists pending resume decisions and consumes them at the next prompt", async () => {
    const temp = mkdtempSync(
      path.join(os.tmpdir(), "pea-runtime-pending-resume-"),
    );
    const registryPath = path.join(temp, "sessions.json");
    const sent: Array<{
      context?: Array<{ description: string; value: string }>;
      resumeDecisions?: unknown;
    }> = [];

    try {
      const firstManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory([]),
        sessionRegistryPath: registryPath,
      });
      const session = await firstManager.createSession({
        protocol: "acp",
        cwd: "C:/repo",
        title: "ACP peco",
      });
      firstManager.recordResumeDecision(session.id, {
        interruptId: "tool-approval:tool-1",
        status: "resolved",
        payload: { optionId: "allow_once" },
      });
      firstManager.close(session.id);

      const secondManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory([], sent),
        sessionRegistryPath: registryPath,
      });
      await secondManager.resumeSession(session.id, {
        cwd: "C:/repo",
        protocol: "acp",
      });
      await secondManager.sendPrompt(session.id, { content: "continue" });

      assert.deepEqual(sent[0]?.resumeDecisions, [
        {
          interruptId: "tool-approval:tool-1",
          status: "resolved",
          payload: { optionId: "allow_once" },
        },
      ]);
      const resumeEntry = sent[0]?.context?.find(
        (entry) => entry.description === "Pea runtime resume decisions",
      );
      assert.ok(resumeEntry);

      await secondManager.sendPrompt(session.id, { content: "next" });
      assert.equal(sent[1]?.resumeDecisions, undefined);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("updates active session resource scope on resume and rejects cwd mismatches", async () => {
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory([]),
    });
    const session = await manager.createSession({
      protocol: "acp",
      cwd: "C:/repo",
      additionalDirectories: ["C:/old"],
      title: "ACP peco",
    });

    const resumed = await manager.resumeSession(session.id, {
      cwd: "C:/repo",
      additionalDirectories: ["C:/new"],
    });

    assert.equal(resumed.id, session.id);
    assert.deepEqual(resumed.additionalDirectories, ["C:\\new"]);
    await assert.rejects(
      () => manager.resumeSession(session.id, { cwd: "C:/other" }),
      /cannot resume with cwd/,
    );
  });

  it("rejects cross-protocol resume and fork requests", async () => {
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory([]),
    });
    const session = await manager.createSession({
      protocol: "ag-ui",
      cwd: "C:/repo",
      title: "AG-UI thread-a",
    });

    await assert.rejects(
      () =>
        manager.resumeSession(session.id, { protocol: "acp", cwd: "C:/repo" }),
      /cannot resume as 'acp'/,
    );
    await assert.rejects(
      () =>
        manager.forkSession(session.id, { protocol: "acp", cwd: "C:/repo" }),
      /cannot fork as 'acp'/,
    );
  });

  it("returns cancelled when the active turn is aborted", async () => {
    const manager = new PeaRuntimeProtocolSessions({
      runtime: "peco",
      idPrefix: "test",
      factory: fakeFactory([], [], (sessionId) => manager.cancel(sessionId)),
    });
    const session = await manager.createSession({
      protocol: "ag-ui",
      cwd: "C:/repo",
      title: "AG-UI thread-a",
    });

    assert.equal(
      await manager.sendPrompt(session.id, { content: "stop" }),
      "cancelled",
    );
  });

  it("persists protocol session records and rehydrates them for metadata-only resume", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-runtime-sessions-"));
    const registryPath = path.join(temp, "sessions.json");
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];

    try {
      const firstManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(firstCalls),
        sessionRegistryPath: registryPath,
      });
      const session = await firstManager.createSession({
        protocol: "acp",
        cwd: "C:/repo",
        additionalDirectories: ["C:/shared"],
        title: "ACP peco",
      });

      firstManager.close(session.id);
      assert.deepEqual(firstManager.listSessions({ protocol: "acp" }), [
        {
          id: "test-1",
          protocol: "acp",
          cwd: "C:\\repo",
          additionalDirectories: ["C:\\shared"],
          title: "ACP peco",
          threadId: "thread-1",
          resourceId: "resource-1",
          createdAt: session.createdAt,
          updatedAt: firstManager.listSessions({ protocol: "acp" })[0]
            ?.updatedAt,
          promptActive: false,
        },
      ]);

      const secondManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(secondCalls),
        sessionRegistryPath: registryPath,
      });
      assert.equal(
        secondManager.listSessions({ protocol: "acp" })[0]?.id,
        "test-1",
      );

      const resumed = await secondManager.resumeSession("test-1", {
        cwd: "C:/repo",
        additionalDirectories: ["C:/new"],
      });

      assert.equal(resumed.id, "test-1");
      assert.equal(resumed.threadId, "thread-1");
      assert.deepEqual(resumed.additionalDirectories, ["C:\\new"]);
      assert.deepEqual(secondCalls, [
        "createRuntime:C:\\repo:acp",
        "createThread:ACP peco",
      ]);
      assert.equal(
        (await secondManager.createSession({ protocol: "acp", cwd: "C:/repo" }))
          .id,
        "test-2",
      );

      secondManager.delete("test-1");
      const thirdManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory([]),
        sessionRegistryPath: registryPath,
      });
      assert.deepEqual(
        thirdManager
          .listSessions({ protocol: "acp" })
          .map((record) => record.id),
        ["test-2"],
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("forks persisted protocol history into a new runtime thread", async () => {
    const temp = mkdtempSync(
      path.join(os.tmpdir(), "pea-runtime-fork-sessions-"),
    );
    const registryPath = path.join(temp, "sessions.json");
    const secondCalls: string[] = [];
    const sent: Array<{
      context?: Array<{ description: string; value: string }>;
    }> = [];

    try {
      const firstManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory([]),
        sessionRegistryPath: registryPath,
      });
      const source = await firstManager.createSession({
        protocol: "acp",
        cwd: "C:/repo",
        additionalDirectories: ["C:/shared"],
        title: "ACP peco",
      });
      await firstManager.sendPrompt(source.id, { content: "hello fork" });
      firstManager.recordProtocolEvent(source.id, "acp", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "assistant history" },
      });
      firstManager.close(source.id);

      const secondManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(secondCalls, sent),
        sessionRegistryPath: registryPath,
      });

      const fork = await secondManager.forkSession(source.id, {
        cwd: "C:/repo",
        additionalDirectories: ["C:/fork"],
      });

      assert.equal(fork.id, "test-2");
      assert.equal(fork.protocol, "acp");
      assert.equal(fork.threadId, "thread-1");
      assert.equal(fork.resourceId, "resource-1");
      assert.equal(fork.externalThreadId, undefined);
      assert.deepEqual(fork.additionalDirectories, ["C:\\fork"]);
      assert.deepEqual(
        secondManager.history(fork.id).map((entry) => entry.type),
        ["prompt", "protocol_event"],
      );
      assert.deepEqual(secondCalls, [
        "createRuntime:C:\\repo:acp",
        "createThread:ACP peco fork",
      ]);

      await secondManager.sendPrompt(fork.id, { content: "next" });
      const restoredHistory = sent[0]?.context?.find(
        (entry) =>
          entry.description === "Pea restored protocol session history",
      );
      assert.ok(restoredHistory);
      assert.match(restoredHistory.value, /hello fork/);
      assert.match(restoredHistory.value, /assistant history/);

      await assert.rejects(
        () => secondManager.forkSession(source.id, { cwd: "C:/other" }),
        /cannot fork with cwd/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("persists AG-UI external thread mappings across runtime session managers", async () => {
    const temp = mkdtempSync(
      path.join(os.tmpdir(), "pea-runtime-agui-sessions-"),
    );
    const registryPath = path.join(temp, "sessions.json");
    const secondCalls: string[] = [];

    try {
      const firstManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory([]),
        sessionRegistryPath: registryPath,
      });
      const first = await firstManager.getOrCreateThreadSession({
        protocol: "ag-ui",
        externalThreadId: "ag-thread-1",
        cwd: "C:/repo",
        title: "AG-UI ag-thread-1",
      });
      firstManager.close(first.id);

      const secondManager = new PeaRuntimeProtocolSessions({
        runtime: "peco",
        idPrefix: "test",
        factory: fakeFactory(secondCalls),
        sessionRegistryPath: registryPath,
      });
      const second = await secondManager.getOrCreateThreadSession({
        protocol: "ag-ui",
        externalThreadId: "ag-thread-1",
        cwd: "C:/repo",
        title: "AG-UI ag-thread-1",
      });

      assert.equal(second.id, first.id);
      assert.equal(second.externalThreadId, "ag-thread-1");
      assert.deepEqual(secondCalls, [
        "createRuntime:C:\\repo:ag-ui",
        "createThread:AG-UI ag-thread-1",
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

function fakeFactory(
  calls: string[],
  sent: unknown[] = [],
  onSend?: (sessionId: string) => void,
): PeaRuntimeFactory {
  let threadNumber = 0;
  let currentSessionId = "";
  return {
    runtimeId: "peco",
    async create(request) {
      calls.push(`createRuntime:${request.cwd}:${request.protocol}`);
      return {
        runtimeId: "peco",
        workspace: {
          cwd: request.cwd ?? "C:/repo",
          projectRoot: request.cwd ?? "C:/repo",
          hostBaseUrl: "http://127.0.0.1",
          workspaceKey: "default",
        },
        sessions: {
          async createThreadSession(options?: { title?: string }) {
            calls.push(`createThread:${options?.title}`);
            threadNumber += 1;
            currentSessionId = `test-${threadNumber}`;
            return {
              threadId: `thread-${threadNumber}`,
              resourceId: `resource-${threadNumber}`,
            };
          },
          async switchThread(options: { threadId: string }) {
            calls.push(`switch:${options.threadId}`);
          },
          async sendMessage(message: {
            content: string;
            context?: Array<{ description: string; value: string }>;
            client?: unknown;
            resumeDecisions?: unknown;
            protocol?: string;
          }) {
            calls.push(`send:${message.content}:${message.protocol}`);
            sent.push(message);
            onSend?.(currentSessionId);
          },
          abort() {
            calls.push("abort");
          },
          subscribe() {
            return () => undefined;
          },
        },
      } as unknown as PeaAnyRuntime;
    },
  };
}
