import { expect, test } from "vite-plus/test";
import { createToolListCapture } from "../src/tool-list-capture.ts";

// A minimal stand-in for a v2 language model: the proxy only cares about
// `specificationVersion` + `doStream`/`doGenerate`.
function fakeModel() {
  const calls: unknown[] = [];
  return {
    model: {
      specificationVersion: "v2" as const,
      modelId: "test",
      doStream(args: unknown) {
        calls.push(args);
        return { stream: "ok" };
      },
    },
    calls,
  };
}

test("createToolListCapture records the tool list at the provider boundary", () => {
  const capture = createToolListCapture();
  const { model } = fakeModel();

  const wrapped = capture.wrap(model as never) as unknown as typeof model;
  // Nothing captured until a call actually happens.
  expect(capture.snapshot.tools).toEqual([]);

  const result = wrapped.doStream({
    tools: [
      { name: "read", type: "function", description: "x".repeat(40) },
      { name: "bash", type: "function" },
    ],
  });

  // Forwards to the real model unchanged.
  expect(result).toEqual({ stream: "ok" });
  // Snapshot now holds the exact list, with a char/4 token estimate per tool.
  expect(capture.snapshot.tools.map((t) => t.name)).toEqual(["read", "bash"]);
  expect(capture.snapshot.tools[0]?.approxTokens).toBeGreaterThan(0);
  expect(capture.snapshot.updatedAt).toBeDefined();
});

test("createToolListCapture passes non-model configs through untouched", () => {
  const capture = createToolListCapture();
  // A model-id string is a valid MastraModelConfig — must pass through, not wrap.
  expect(capture.wrap("anthropic/claude-opus-4-8" as never)).toBe("anthropic/claude-opus-4-8");
  // An object without a v2/v3 spec version is left alone too.
  const plain = { foo: "bar" };
  expect(capture.wrap(plain as never)).toBe(plain);
});
