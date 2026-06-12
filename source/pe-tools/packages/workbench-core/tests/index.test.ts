import type {
  WorkbenchAgentClient,
  WorkbenchEvent,
  WorkbenchEventHandler,
  WorkbenchLoadThreadRequest,
  WorkbenchNewSessionRequest,
  WorkbenchPromptRequest,
} from "@pe/agent-contracts";
import { describe, expect, test } from "vite-plus/test";
import { createWorkbenchController } from "../src/index.js";

class TestWorkbenchClient implements WorkbenchAgentClient {
  readonly sentPrompts: WorkbenchPromptRequest[] = [];
  readonly loadedThreads: WorkbenchLoadThreadRequest[] = [];
  readonly models: string[] = [];
  readonly modes: string[] = [];
  readonly canceledSessions: string[] = [];
  failSend = false;
  private readonly handlers = new Set<WorkbenchEventHandler>();

  subscribe(handler: WorkbenchEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async initialize() {
    return {
      name: "test-agent",
      capabilities: { threads: true, modelSwitching: true, sessionModes: true },
    };
  }

  async newSession(request: WorkbenchNewSessionRequest) {
    return {
      sessionId: "session-1",
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories ?? [],
    };
  }

  async sendPrompt(request: WorkbenchPromptRequest) {
    this.sentPrompts.push(request);
    if (this.failSend) throw new Error("send failed");
    this.emit({
      type: "message_part_delta",
      messageId: "assistant-1",
      role: "assistant",
      part: { kind: "text", text: "hello back" },
      status: "complete",
    });
    return { stopReason: "end_turn" as const };
  }

  async listThreads() {
    return [
      { threadId: "session-1", title: "Current" },
      { threadId: "thread-2", title: "Existing" },
    ];
  }

  async loadThread(request: WorkbenchLoadThreadRequest) {
    this.loadedThreads.push(request);
    this.emit({
      type: "transcript_replaced",
      messages: [
        {
          id: "loaded-message",
          role: "assistant",
          parts: [{ kind: "text", text: "loaded" }],
          status: "complete",
        },
      ],
    });
    return {
      sessionId: request.threadId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories ?? [],
    };
  }

  resolveApproval(requestId: string, optionId?: string): void {
    this.emit({
      type: "approval_resolved",
      requestId,
      resolution: { optionId, resolvedAt: "2026-06-11T10:00:00.000Z" },
    });
  }

  cancel(sessionId: string): void {
    this.canceledSessions.push(sessionId);
  }

  setModel(modelId: string): void {
    this.models.push(modelId);
  }

  setMode(modeId: string): void {
    this.modes.push(modeId);
  }

  emit(event: WorkbenchEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

describe("WorkbenchController", () => {
  test("starts with returned agent, session, and thread state", async () => {
    const client = new TestWorkbenchClient();
    const controller = createWorkbenchController(client, { cwd: "C:/repo" });

    await controller.start();

    expect(controller.getState().agent.info?.name).toBe("test-agent");
    expect(controller.getState().agent.session?.sessionId).toBe("session-1");
    expect(controller.getState().threads.items).toEqual([
      expect.objectContaining({ threadId: "session-1" }),
      expect.objectContaining({ threadId: "thread-2" }),
    ]);
    expect(controller.getState().threads.activeThreadId).toBe("session-1");
    expect(controller.getState().uiStatus.start.status).toBe("succeeded");
  });

  test("sends optimistic local message and projects assistant reply", async () => {
    const client = new TestWorkbenchClient();
    const controller = createWorkbenchController(client, { cwd: "C:/repo" });

    await controller.send("hello");

    expect(client.sentPrompts).toEqual([{ sessionId: "session-1", text: "hello" }]);
    expect(controller.getState().transcript.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(controller.getState().transcript.messages[0]?.parts).toEqual([
      expect.objectContaining({ kind: "text", text: "hello\n" }),
    ]);
    expect(controller.getState().transcript.messages[1]?.parts).toEqual([
      expect.objectContaining({ kind: "text", text: "hello back" }),
    ]);
    expect(controller.getState().uiStatus.send.status).toBe("succeeded");
  });

  test("loads a thread through the shared command surface", async () => {
    const client = new TestWorkbenchClient();
    const controller = createWorkbenchController(client, { cwd: "C:/repo" });

    await controller.start();
    await controller.loadThread("thread-2");

    expect(client.loadedThreads).toEqual([
      { threadId: "thread-2", cwd: "C:/repo", additionalDirectories: undefined },
    ]);
    expect(controller.getState().agent.session?.sessionId).toBe("thread-2");
    expect(controller.getState().threads.selectedThreadId).toBe("thread-2");
    expect(controller.getState().transcript.messages).toEqual([
      expect.objectContaining({ id: "loaded-message" }),
    ]);
    expect(controller.getState().uiStatus.loadThread.status).toBe("succeeded");
  });

  test("resolves approvals, cancels runs, and changes model and mode", async () => {
    const client = new TestWorkbenchClient();
    const controller = createWorkbenchController(client, { cwd: "C:/repo" });

    await controller.start();
    client.emit({
      type: "approval_requested",
      approval: {
        requestId: "approval-1",
        sessionId: "session-1",
        toolCall: { id: "tool-1", title: "Edit", status: "in_progress" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        status: "pending",
      },
    });

    controller.resolveApproval("approval-1", "allow");
    await controller.cancel();
    await controller.setModel({ modelId: "openai/gpt-5.5" });
    await controller.setMode({ modeId: "agent" });

    expect(controller.getState().approvals.requests[0]?.status).toBe("resolved");
    expect(client.canceledSessions).toEqual(["session-1"]);
    expect(client.models).toEqual(["openai/gpt-5.5"]);
    expect(client.modes).toEqual(["agent"]);
    expect(controller.getState().models.currentModelId).toBe("openai/gpt-5.5");
    expect(controller.getState().modes.currentModeId).toBe("agent");
  });

  test("surfaces command errors in shared uiStatus", async () => {
    const client = new TestWorkbenchClient();
    client.failSend = true;
    const controller = createWorkbenchController(client, { cwd: "C:/repo" });

    await expect(controller.send("hello")).rejects.toThrow("send failed");

    expect(controller.getState().uiStatus.send.status).toBe("failed");
    expect(controller.getState().uiStatus.send.error).toBe("send failed");
    expect(controller.getState().uiStatus.errors).toEqual(["send failed"]);
  });
});
