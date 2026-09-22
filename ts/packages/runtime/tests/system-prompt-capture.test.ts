import { expect, test } from "vite-plus/test";
import { createSystemPromptCapture } from "../src/system-prompt-capture.ts";

test("createSystemPromptCapture captures resolved system messages into the shared snapshot", () => {
  const { snapshot, processor } = createSystemPromptCapture({
    content: "base instructions",
    source: "static",
  });

  // Snapshot starts at the static seed (what the workbench shows pre-flight).
  expect(snapshot.content).toBe("base instructions");

  const result = processor.processLLMRequest?.({
    // Prompt as mastra hands it to the processor: system blocks + a user turn.
    prompt: [
      { role: "system", content: "base + skills" },
      { role: "system", content: "runtime context" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ],
  } as never);

  // Read-only: prompt forwarded unchanged.
  expect(result).toBeUndefined();
  // Same object mutated in place -> workbench metadata emits the resolved prompt.
  expect(snapshot.content).toBe("base + skills\n---\nruntime context");
  expect(snapshot.source).toBe("resolved (provider boundary)");
  expect(typeof snapshot.updatedAt).toBe("string");
});
