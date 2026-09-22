import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { peaProductTools } from "@pe/mcps";
import { expect, test } from "vite-plus/test";
import { createDeterministicRuntime } from "../src/testing.ts";

/**
 * An invalid `diagram` call fails loudly: the model's next turn carries the validation error with
 * every offending path, so one retry can fix them all.
 */
test("an invalid diagram call's error reaches the model with every path", async () => {
  const prompts: unknown[] = [];
  const runtime = await createDeterministicRuntime({
    databasePath: join(mkdtempSync(join(tmpdir(), "pe-diagram-")), "diagram.db"),
    resourceId: "diagram-resource",
    tools: { diagram: peaProductTools.diagram },
    onPrompt: (prompt) => void prompts.push(prompt),
    responses: [
      {
        toolCall: {
          name: "diagram",
          input: {
            nodes: [
              { id: "AHU", label: "AHU-1" },
              { id: "AHU", label: "again" },
            ],
            edges: [
              { from: "AHU", to: "AHU" },
              { from: "AHU", to: "AHU" },
              { from: "AHU", to: "AHU" },
              { from: "AHU", to: "VAV-9" },
            ],
          },
        },
      },
      { text: "fixed" },
    ],
  });
  try {
    const session = await runtime.controller.createSession({
      resourceId: runtime.resourceId,
      scope: "diagram-thread",
      threadId: "diagram-thread",
    });
    // This runtime has no category for the tool, so it asks; approve it the way the chat would.
    session.subscribe((event: { type: string; toolCallId?: string }) => {
      if (event.type === "tool_approval_required" && event.toolCallId)
        session.respondToToolApproval({ decision: "approve", toolCallId: event.toolCallId });
    });
    await session.sendMessage({ content: "draw the duct system" });
    // The admitted turn runs past `sendMessage`; wait for the model's second call.
    for (let i = 0; i < 100 && prompts.length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const next = JSON.stringify(prompts[1]);
    expect(next).toContain("Tool input validation failed for diagram");
    expect(next).toContain('edges.3.to: no node \\"VAV-9\\"');
    expect(next).toContain('nodes.1.id: duplicate id \\"AHU\\"');
  } finally {
    await runtime.close?.();
  }
});
