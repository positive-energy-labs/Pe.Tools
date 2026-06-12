import type { WorkbenchEvent, WorkbenchState } from "@pe/agent-contracts";
import { applyWorkbenchEvent, createWorkbenchState } from "@pe/agent-projection";
import type { WorkbenchStateHandler } from "@pe/workbench-core";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  startWorkbenchTransportServer,
  type WorkbenchTransportServerHandle,
} from "../src/index.ts";

class FakeController {
  state = createWorkbenchState();
  sent: string[] = [];
  loadedThreads: string[] = [];
  resolvedApprovals: Array<{ requestId: string; optionId?: string }> = [];
  canceled = 0;
  models: string[] = [];
  modes: string[] = [];
  private readonly handlers = new Set<WorkbenchStateHandler>();

  getState(): WorkbenchState {
    return this.state;
  }

  subscribe(handler: WorkbenchStateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    this.emit({ type: "agent_initialized", agent: { name: "fake", capabilities: {} } });
  }

  async send(text: string): Promise<void> {
    this.sent.push(text);
    this.emit({
      type: "message_part_delta",
      messageId: "assistant-1",
      role: "assistant",
      part: { kind: "text", text },
      status: "complete",
    });
  }

  async refreshThreads(): Promise<void> {
    this.emit({ type: "threads_replaced", threads: [{ threadId: "thread-1", title: "One" }] });
  }

  async loadThread(threadId: string): Promise<void> {
    this.loadedThreads.push(threadId);
    this.emit({ type: "thread_selected", threadId });
  }

  resolveApproval(requestId: string, optionId?: string): void {
    this.resolvedApprovals.push({ requestId, optionId });
  }

  async cancel(): Promise<void> {
    this.canceled += 1;
  }

  async setModel(request: { modelId: string }): Promise<void> {
    this.models.push(request.modelId);
  }

  async setMode(request: { modeId: string }): Promise<void> {
    this.modes.push(request.modeId);
  }

  emit(event: WorkbenchEvent): void {
    this.state = applyWorkbenchEvent(this.state, event);
    for (const handler of this.handlers) handler(this.state, event);
  }
}

describe("workbench transport", () => {
  const handles: WorkbenchTransportServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  test("serves current state snapshots", async () => {
    const controller = new FakeController();
    controller.emit({ type: "agent_initialized", agent: { name: "fake", capabilities: {} } });
    const handle = await startWorkbenchTransportServer(controller);
    handles.push(handle);

    const response = await fetch(`${handle.apiUrl}/api/workbench/state`);

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ info: expect.objectContaining({ name: "fake" }) }),
      }),
    );
  });

  test("routes typed command posts and returns updated state", async () => {
    const controller = new FakeController();
    const handle = await startWorkbenchTransportServer(controller);
    handles.push(handle);

    const sendResponse = await post(handle, "/api/workbench/commands/send", { text: "hello" });
    await post(handle, "/api/workbench/commands/threads/load", { threadId: "thread-1" });
    await post(handle, "/api/workbench/commands/approvals/resolve", {
      requestId: "approval-1",
      optionId: "allow",
    });
    await post(handle, "/api/workbench/commands/cancel");
    await post(handle, "/api/workbench/commands/model", { modelId: "openai/gpt-5.5" });
    await post(handle, "/api/workbench/commands/mode", { modeId: "agent" });

    expect(sendResponse.state.transcript.messages).toEqual([
      expect.objectContaining({ id: "assistant-1" }),
    ]);
    expect(controller.sent).toEqual(["hello"]);
    expect(controller.loadedThreads).toEqual(["thread-1"]);
    expect(controller.resolvedApprovals).toEqual([{ requestId: "approval-1", optionId: "allow" }]);
    expect(controller.canceled).toBe(1);
    expect(controller.models).toEqual(["openai/gpt-5.5"]);
    expect(controller.modes).toEqual(["agent"]);
  });

  test("streams workbench events as SSE", async () => {
    const controller = new FakeController();
    const handle = await startWorkbenchTransportServer(controller);
    handles.push(handle);

    const response = await fetch(`${handle.apiUrl}/api/workbench/events`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing SSE response body.");

    controller.emit({ type: "threads_replaced", threads: [{ threadId: "thread-1" }] });
    const first = await reader.read();
    const second = await reader.read();
    reader.releaseLock();

    const text = `${decode(first.value)}${decode(second.value)}`;
    expect(text).toContain("event: workbench-state");
    expect(text).toContain("event: workbench-event");
    expect(text).toContain("threads_replaced");
  });
});

async function post(handle: WorkbenchTransportServerHandle, pathName: string, body: unknown = {}) {
  const response = await fetch(`${handle.apiUrl}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as { state: WorkbenchState };
}

function decode(value: Uint8Array | undefined): string {
  return value ? new TextDecoder().decode(value) : "";
}
