import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPeaRuntimeResumeContextEntries,
  PeaRuntimeInterruptCollector,
  toPeaRuntimeResumeDecisions,
} from "../pea-runtime-interrupts.js";

describe("Pea runtime interrupts", () => {
  it("collects suspended tool interrupts with response schemas and sanitized metadata", () => {
    const collector = new PeaRuntimeInterruptCollector();

    collector.observe({
      type: "tool_started",
      toolCallId: "tool-1",
      toolName: "edit_file",
      title: "Edit file",
      status: "suspended",
      input: { path: "C:/repo/app.ts" },
      suspendPayload: { reason: "requires_review" },
      resumeSchema: {
        type: "object",
        properties: { approved: { type: "boolean" } },
      },
    });
    collector.observe({ type: "run_finished", reason: "suspended" });

    assert.deepEqual(collector.outcome(), {
      type: "interrupt",
      interrupts: [
        {
          id: "tool-suspended:tool-1",
          reason: "tool_suspended",
          message: "Edit file",
          toolCallId: "tool-1",
          responseSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
          },
          metadata: {
            title: "Edit file",
            toolName: "edit_file",
            status: "suspended",
            input: { path: "C:/repo/app.ts" },
            suspendPayload: { reason: "requires_review" },
          },
        },
      ],
    });
  });

  it("collects plan approval requests as runtime interrupts", () => {
    const collector = new PeaRuntimeInterruptCollector();

    collector.observe({
      type: "plan_requested",
      title: "Approve implementation plan",
      plan: "1. Inspect\n2. Patch\n3. Verify",
    });

    assert.deepEqual(collector.outcome(), {
      type: "interrupt",
      interrupts: [
        {
          id: "plan-approval:1",
          reason: "plan_approval_required",
          message: "Approve implementation plan",
          metadata: {
            title: "Approve implementation plan",
            plan: "1. Inspect\n2. Patch\n3. Verify",
          },
        },
      ],
    });
  });

  it("adds a runtime-level fallback when a run suspends without a specific interrupt event", () => {
    const collector = new PeaRuntimeInterruptCollector();

    collector.observe({ type: "run_finished", reason: "suspended" });

    assert.deepEqual(collector.outcome(), {
      type: "interrupt",
      interrupts: [
        {
          id: "runtime-suspended",
          reason: "runtime_suspended",
          message: "Runtime suspended and is waiting for client input.",
        },
      ],
    });
  });

  it("normalizes protocol resume decisions into Pea runtime context entries", () => {
    const decisions = toPeaRuntimeResumeDecisions([
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved",
        payload: { approved: true, dropped: undefined },
      },
      {
        interruptId: "plan-approval:1",
        status: "cancelled",
      },
    ]);

    assert.deepEqual(decisions, [
      {
        interruptId: "tool-suspended:tool-1",
        status: "resolved",
        payload: { approved: true, dropped: null },
      },
      {
        interruptId: "plan-approval:1",
        status: "cancelled",
      },
    ]);
    const entries = createPeaRuntimeResumeContextEntries(decisions);
    assert.equal(entries[0]?.description, "Pea runtime resume decisions");
    assert.deepEqual(JSON.parse(entries[0]?.value ?? "[]"), decisions);
  });
});
