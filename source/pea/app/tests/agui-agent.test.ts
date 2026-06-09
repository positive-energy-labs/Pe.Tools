import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { PeaAgUiAgent, PeaAgUiHttpAgent } from "../agui/pea-agui-agent.js";
import type { PeaRuntime } from "../pea-runtime.js";
import type { PeaRuntimeEvent } from "../pea-runtime-events.js";
import { PeaRuntimeProtocolSessions } from "../pea-runtime-protocol-sessions.js";

interface SentMessage {
  content: string;
  protocol?: string;
  context?: Array<{ value: string; description: string }>;
  resumeDecisions?: unknown;
}

describe("AG-UI agent", () => {
  it("runs through the Pea session seam and translates runtime events", async () => {
    const runtime = fakeRuntime({
      onSendMessage: (listener) => {
        listener(assistantDelta("assistant-1", "hello"));
        listener(assistantDelta("assistant-1", " world"));
        listener({ type: "assistant_message_finished", messageId: "assistant-1" });
      },
    });
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: runtime });
    const events: BaseEvent[] = [];

    await agent.run(runInput(), (event) => events.push(event));

    assert.deepEqual(runtime.calls, [
      "create:AG-UI ag-thread-1",
      "switch:harness-thread-1",
      "send:hello from ag-ui",
    ]);
    assert.deepEqual(runtime.sent, [
      {
        content: "hello from ag-ui",
        protocol: "ag-ui",
        context: [
          { value: "active model", description: "Revit context" },
          {
            value: '{\n  "panel": "families"\n}',
            description: "AG-UI thread state supplied by the client",
          },
        ],
        protocolSessionId: "pea-agui-1",
      },
    ]);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.MESSAGES_SNAPSHOT,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ],
    );
    assert.deepEqual(events.at(-1), {
      type: EventType.RUN_FINISHED,
      threadId: "ag-thread-1",
      runId: "run-1",
      outcome: { type: "success" },
      rawEvent: { stopReason: "end_turn" },
      sequence: 8,
    });
    assert.deepEqual(events.map(eventSequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(events[1], {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { panel: "families" },
      sequence: 2,
    });
    assert.equal(events[2]?.type, EventType.MESSAGES_SNAPSHOT);
  });

  it("reuses the mapped Pea runtime session for later AG-UI runs on the same thread", async () => {
    const runtime = fakeRuntime();
    const agent = new PeaAgUiAgent({ runtime: "dev-agent", runtimeOverride: runtime });

    await agent.run(runInput(), () => undefined);
    await agent.run({ ...runInput(), runId: "run-2" }, () => undefined);

    assert.deepEqual(runtime.calls, [
      "create:AG-UI ag-thread-1",
      "switch:harness-thread-1",
      "send:hello from ag-ui",
      "switch:harness-thread-1",
      "send:hello from ag-ui",
    ]);
  });

  it("persists AG-UI event history and injects it after thread rehydration", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-agui-thread-history-"));
    const registryPath = path.join(temp, "sessions.json");

    try {
      const firstRuntime = fakeRuntime({
        onSendMessage: (listener) => {
          listener(assistantDelta("assistant-1", "first answer"));
          listener({ type: "assistant_message_finished", messageId: "assistant-1" });
        },
      });
      const firstSessions = new PeaRuntimeProtocolSessions({
        runtime: "pea",
        idPrefix: "test-agui",
        factory: fakeFactory(firstRuntime),
        sessionRegistryPath: registryPath,
      });
      const firstAgent = new PeaAgUiAgent({
        runtime: "pea",
        workspaceRoot: "C:/repo",
        runtimeSessions: firstSessions,
      });
      await firstAgent.run(runInput(), () => undefined);
      await firstAgent.close();

      const secondRuntime = fakeRuntime();
      const secondSessions = new PeaRuntimeProtocolSessions({
        runtime: "pea",
        idPrefix: "test-agui",
        factory: fakeFactory(secondRuntime),
        sessionRegistryPath: registryPath,
      });
      const secondAgent = new PeaAgUiAgent({
        runtime: "pea",
        workspaceRoot: "C:/repo",
        runtimeSessions: secondSessions,
      });

      await secondAgent.run(
        {
          ...runInput(),
          runId: "run-2",
          messages: [{ id: "user-2", role: "user", content: "continue" }],
        },
        () => undefined,
      );

      const restoredHistory = secondRuntime.sent[0]?.context?.find(
        (entry) => entry.description === "Pea restored protocol session history",
      );
      assert.ok(restoredHistory);
      assert.match(restoredHistory.value, /hello from ag-ui/);
      assert.match(restoredHistory.value, /TEXT_MESSAGE_CONTENT/);
      assert.match(restoredHistory.value, /first answer/);
      assert.deepEqual(secondRuntime.calls, [
        "create:AG-UI ag-thread-1",
        "switch:harness-thread-1",
        "send:continue",
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("forwards AG-UI multimodal input parts as Pea runtime resources", async () => {
    const runtime = fakeRuntime();
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: runtime });

    await agent.run(
      {
        ...runInput(),
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [
              { type: "text", text: "inspect this image" },
              {
                type: "image",
                source: {
                  type: "url",
                  value: "file:///C:/repo/sheet.png",
                  mimeType: "image/png",
                },
                metadata: { page: 1 },
              },
            ],
          },
        ],
      },
      () => undefined,
    );

    const resourceEntry = runtime.sent[0]?.context?.find((entry) =>
      entry.value.includes("ag-ui:user-1:1"),
    );
    assert.ok(resourceEntry);
    assert.deepEqual(JSON.parse(resourceEntry.value), {
      id: "ag-ui:user-1:1",
      kind: "input",
      protocol: "ag-ui",
      uri: "file:///C:/repo/sheet.png",
      title: "image",
      mimeType: "image/png",
      source: {
        type: "image",
        source: { type: "url", value: "file:///C:/repo/sheet.png", mimeType: "image/png" },
        metadata: { page: 1 },
      },
      metadata: { page: 1 },
      path: "C:\\repo\\sheet.png",
      inScope: true,
    });
  });

  it("uses AG-UI forwarded Pea runtime scope without prompt-widening control metadata", async () => {
    const runtime = fakeRuntime();
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: runtime });

    await agent.run(runInput(), () => undefined);
    await agent.run(
      {
        ...runInput(),
        runId: "run-2",
        forwardedProps: {
          pea: {
            cwd: "C:/repo",
            additionalDirectories: ["C:/shared"],
          },
          visiblePanel: "families",
        },
        messages: [
          {
            id: "user-2",
            role: "user",
            content: [
              { type: "text", text: "inspect shared image" },
              {
                type: "image",
                source: {
                  type: "url",
                  value: "file:///C:/shared/sheet.png",
                  mimeType: "image/png",
                },
              },
            ],
          },
        ],
      },
      () => undefined,
    );

    assert.deepEqual(runtime.calls, [
      "create:AG-UI ag-thread-1",
      "switch:harness-thread-1",
      "send:hello from ag-ui",
      "switch:harness-thread-1",
      "send:inspect shared image\n\n[AG-UI image input: file:///C:/shared/sheet.png]",
    ]);
    const scopeEntry = runtime.sent[1]?.context?.find(
      (entry) => entry.description === "Pea runtime resource scope",
    );
    assert.deepEqual(JSON.parse(scopeEntry?.value ?? "{}"), {
      cwd: "C:\\repo",
      additionalDirectories: ["C:\\shared"],
    });
    const resourceEntry = runtime.sent[1]?.context?.find((entry) =>
      entry.value.includes("ag-ui:user-2:1"),
    );
    assert.deepEqual(JSON.parse(resourceEntry?.value ?? "{}").inScope, true);
    const forwardedPropsEntry = runtime.sent[1]?.context?.find(
      (entry) => entry.description === "AG-UI forwarded properties supplied by the client",
    );
    assert.deepEqual(JSON.parse(forwardedPropsEntry?.value ?? "{}"), {
      visiblePanel: "families",
    });
  });

  it("normalizes AG-UI resume decisions through the Pea runtime interrupt contract", async () => {
    const runtime = fakeRuntime();
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: runtime });

    await agent.run(
      {
        ...runInput(),
        resume: [
          {
            interruptId: "tool-suspended:tool-1",
            status: "resolved",
            payload: { approved: true },
          },
        ],
      },
      () => undefined,
    );

    const resumeEntry = runtime.sent[0]?.context?.find(
      (entry) => entry.description === "Pea runtime resume decisions",
    );
    assert.deepEqual(runtime.sent[0]?.resumeDecisions, [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved",
        payload: { approved: true },
      },
    ]);
    assert.ok(resumeEntry);
    assert.deepEqual(JSON.parse(resumeEntry.value), [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved",
        payload: { approved: true },
      },
    ]);
    assert.equal(
      runtime.sent[0]?.context?.some(
        (entry) => entry.description === "AG-UI resume decisions supplied by the client",
      ),
      false,
    );
  });

  it("emits AG-UI approval interrupt outcomes for request_access", async () => {
    const runtime = fakeRuntime({
      onSendMessage: (listener) => {
        listener({
          type: "tool_started",
          toolCallId: "tool-1",
          toolName: "request_access",
          title: "Request Access",
          status: "pending_approval",
          input: { path: "C:/other", reason: "inspect requested files" },
        });
        listener({ type: "run_finished", reason: "suspended" });
      },
    });
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: runtime });
    const events: BaseEvent[] = [];

    await agent.run(runInput(), (event) => events.push(event));

    assert.deepEqual(
      events.map((event) => event.type),
      [
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.MESSAGES_SNAPSHOT,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.RUN_FINISHED,
      ],
    );
    assert.deepEqual(events.at(-1), {
      type: EventType.RUN_FINISHED,
      threadId: "ag-thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "tool-approval:tool-1",
            reason: "tool_approval_required",
            message: "Request Access",
            toolCallId: "tool-1",
            metadata: {
              title: "Request Access",
              toolName: "request_access",
              status: "pending_approval",
              input: { path: "C:/other", reason: "inspect requested files" },
              suspendPayload: null,
            },
          },
        ],
      },
      rawEvent: { stopReason: "end_turn" },
      sequence: 6,
    });
  });

  it("advertises AG-UI interrupt support and resumable event replay", () => {
    const agent = new PeaAgUiAgent({ runtime: "pea", runtimeOverride: fakeRuntime() });

    const capabilities = agent.capabilities();

    assert.equal(capabilities.humanInTheLoop?.supported, true);
    assert.equal(capabilities.humanInTheLoop?.approvals, true);
    assert.equal(capabilities.humanInTheLoop?.interrupts, true);
    assert.equal(capabilities.humanInTheLoop?.approveWithEdits, false);
    assert.equal(capabilities.transport?.resumable, true);
  });

  it("serves AG-UI status and run streams over local HTTP/SSE", async () => {
    const runtime = fakeRuntime({
      onSendMessage: (listener) => {
        listener(assistantDelta("assistant-1", "done"));
        listener({ type: "assistant_message_finished", messageId: "assistant-1" });
      },
    });
    const server = new PeaAgUiHttpAgent({
      runtime: "pea",
      port: 0,
      token: "secret",
      runtimeOverride: runtime,
    });
    const info = await server.start();

    try {
      assert.equal((await fetch(stripToken(info.statusUrl))).status, 401);
      const status = await fetch(info.statusUrl);
      assert.equal(status.status, 200);
      const statusJson = await status.json();
      assert.equal(statusJson.runtime, "pea");
      assert.equal(statusJson.protocol, "ag-ui");
      assert.equal(statusJson.transport, "http+sse");
      assert.equal(statusJson.runtimeInfo.name, "Pea");
      assert.equal(statusJson.auth.source, "api-key");
      assert.equal(statusJson.auth.logoutSupported, true);
      assert.equal(statusJson.auth.methods[0].id, "openai-api-key");
      assert.equal(statusJson.capabilities.transport.streaming, true);
      assert.equal(statusJson.capabilities.custom["pea.authSource"], "api-key");
      assert.equal(statusJson.capabilities.custom["pea.logoutSupported"], true);
      assert.equal(statusJson.capabilities.custom["pea.authMethods"][0].id, "openai-api-key");

      const response = await fetch(info.runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runInput()),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const events = parseSseEvents(await response.text());
      assert.deepEqual(events.map(eventSequence), [1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(
        events.map((event) => event.type),
        [
          EventType.RUN_STARTED,
          EventType.STATE_SNAPSHOT,
          EventType.MESSAGES_SNAPSHOT,
          EventType.TEXT_MESSAGE_START,
          EventType.TEXT_MESSAGE_CONTENT,
          EventType.TEXT_MESSAGE_END,
          EventType.RUN_FINISHED,
        ],
      );

      const sessions = await fetch(info.sessionsUrl);
      assert.equal(sessions.status, 200);
      const sessionsJson = await sessions.json();
      assert.equal(sessionsJson.sessions.length, 1);
      assert.equal(sessionsJson.sessions[0].externalThreadId, "ag-thread-1");

      const replay = await fetch(`${info.eventsUrl}&threadId=ag-thread-1&afterSequence=3`);
      assert.equal(replay.status, 200);
      const replayJson = await replay.json();
      assert.deepEqual(
        replayJson.events.map((event: BaseEvent) => event.type),
        [
          EventType.TEXT_MESSAGE_START,
          EventType.TEXT_MESSAGE_CONTENT,
          EventType.TEXT_MESSAGE_END,
          EventType.RUN_FINISHED,
        ],
      );
      assert.deepEqual(replayJson.events.map(eventSequence), [4, 5, 6, 7]);
    } finally {
      await server.close();
    }
  });

  it("closes and deletes AG-UI thread sessions over authenticated HTTP", async () => {
    const runtime = fakeRuntime();
    const server = new PeaAgUiHttpAgent({
      runtime: "pea",
      port: 0,
      token: "secret",
      runtimeOverride: runtime,
    });
    const info = await server.start();

    try {
      const response = await fetch(info.runUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runInput()),
      });
      assert.equal(response.status, 200);
      await response.text();

      const close = await fetch(agUiUrl(info, "/agui/sessions/ag-thread-1/close"), {
        method: "POST",
      });
      assert.equal(close.status, 200);
      assert.deepEqual(await close.json(), { ok: true });
      assert.equal((await fetch(info.sessionsUrl)).status, 200);
      const afterClose = await (await fetch(info.sessionsUrl)).json();
      assert.equal(afterClose.sessions[0]?.externalThreadId, "ag-thread-1");

      const preflight = await fetch(agUiUrl(info, "/agui/sessions/ag-thread-1"), {
        method: "OPTIONS",
      });
      assert.equal(preflight.status, 204);
      assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bDELETE\b/);

      const deleted = await fetch(agUiUrl(info, "/agui/sessions/ag-thread-1"), {
        method: "DELETE",
      });
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { ok: true });
      const afterDelete = await (await fetch(info.sessionsUrl)).json();
      assert.deepEqual(afterDelete.sessions, []);

      const replay = await fetch(`${info.eventsUrl}&threadId=ag-thread-1`);
      assert.deepEqual(await replay.json(), { events: [] });
    } finally {
      await server.close();
    }
  });

  it("requires a generated token when AG-UI HTTP auth is not configured explicitly", async () => {
    const server = new PeaAgUiHttpAgent({
      runtime: "pea",
      port: 0,
      runtimeOverride: fakeRuntime(),
    });
    const info = await server.start();

    try {
      assert.ok(info.token.length > 20);
      assert.equal((await fetch(stripToken(info.statusUrl))).status, 401);
      assert.equal((await fetch(info.statusUrl)).status, 200);
    } finally {
      await server.close();
    }
  });

  it("exposes authenticated AG-UI logout for scoped Pea runtime credentials", async () => {
    const originalProcessKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "process-key";
    const temp = mkdtempSync(path.join(os.tmpdir(), "pea-agui-auth-"));
    const authPath = path.join(temp, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify(
        {
          "openai-codex": { type: "api_key", key: "stored-key" },
          unrelated: { type: "api_key", key: "keep" },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const server = new PeaAgUiHttpAgent({
      runtime: "pea",
      port: 0,
      token: "secret",
      runtimeOverride: fakeRuntime(),
      runtimeAuthPath: authPath,
    });
    const info = await server.start();

    try {
      assert.equal((await fetch(stripToken(info.logoutUrl), { method: "POST" })).status, 401);
      const logout = await fetch(info.logoutUrl, { method: "POST" });
      assert.equal(logout.status, 200);
      assert.deepEqual(await logout.json(), { ok: true });
      const parsed = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>;
      assert.equal(parsed["openai-codex"], undefined);
      assert.deepEqual(parsed.unrelated, { type: "api_key", key: "keep" });
      assert.equal(process.env.OPENAI_API_KEY, undefined);
    } finally {
      await server.close();
      rmSync(temp, { recursive: true, force: true });
      if (originalProcessKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalProcessKey;
      }
    }
  });
});

function runInput(): RunAgentInput {
  return {
    threadId: "ag-thread-1",
    runId: "run-1",
    state: { panel: "families" },
    tools: [],
    context: [{ value: "active model", description: "Revit context" }],
    messages: [{ id: "user-1", role: "user", content: "hello from ag-ui" }],
  };
}

function stripToken(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("token");
  return parsed.toString();
}

function agUiUrl(info: { statusUrl: string }, path: string): string {
  const base = new URL(info.statusUrl);
  return `${base.origin}${path}?token=${encodeURIComponent(base.searchParams.get("token") ?? "")}`;
}

function fakeRuntime(
  options: { onSendMessage?: (listener: (event: PeaRuntimeEvent) => void) => void } = {},
) {
  const listeners: Array<(event: PeaRuntimeEvent) => void> = [];
  const calls: string[] = [];
  const sent: SentMessage[] = [];
  const runtime = {
    calls,
    sent,
    workspace: {
      cwd: "C:/repo",
      hostBaseUrl: "http://127.0.0.1",
      workspaceKey: "default",
    },
    sessions: {
      async createThreadSession(request?: { title?: string }) {
        calls.push(`create:${request?.title}`);
        return { threadId: "harness-thread-1", resourceId: "resource-1" };
      },
      async switchThread(request: { threadId: string }) {
        calls.push(`switch:${request.threadId}`);
      },
      async sendMessage(message: SentMessage) {
        calls.push(`send:${message.content}`);
        sent.push(message);
        for (const listener of listeners) options.onSendMessage?.(listener);
      },
      abort() {},
      subscribe(listener: (event: PeaRuntimeEvent) => void) {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    },
  };
  return runtime as unknown as PeaRuntime & { calls: string[]; sent: SentMessage[] };
}

function fakeFactory(runtime: PeaRuntime) {
  return {
    runtimeId: "pea" as const,
    async create() {
      return runtime;
    },
  };
}

function assistantDelta(id: string, delta: string): PeaRuntimeEvent {
  return {
    type: "assistant_message_delta",
    messageId: id,
    delta,
  };
}

function parseSseEvents(body: string): BaseEvent[] {
  return body
    .trim()
    .split("\n\n")
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as BaseEvent);
}

function eventSequence(event: BaseEvent): number | undefined {
  return (event as { sequence?: number }).sequence;
}
