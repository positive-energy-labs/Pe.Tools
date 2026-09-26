import { describe, expect, test, vi } from "vite-plus/test";
import { ObservationalMemory } from "@mastra/memory/processors";

function toolMessage(index: number, resultSize = 70_000) {
  return {
    id: `message-${index}`,
    threadId: "thread-bounded",
    resourceId: "resource-bounded",
    role: "assistant" as const,
    type: "text" as const,
    createdAt: new Date(2026, 8, 26, 12, 0, index),
    content: {
      format: 2 as const,
      parts: [
        {
          type: "tool-invocation" as const,
          toolInvocation: {
            state: "result" as const,
            toolCallId: `call-${index}`,
            toolName: "pe_do",
            args: { index },
            result: { output: `${index}-${"x".repeat(resultSize)}` },
          },
        },
      ],
    },
  };
}

function observerHarness(failOnCall?: number) {
  const om = new ObservationalMemory({
    storage: {} as never,
    model: "openai/gpt-5.4-mini",
    observation: { messageTokens: 75_000, instruction: "Only durable facts." },
    reflection: { observationTokens: 15_000 },
  });
  const requests: unknown[][] = [];
  vi.spyOn(
    om.observer as unknown as { createAgent: (...args: unknown[]) => unknown },
    "createAgent",
  ).mockImplementation(
    () =>
      ({
        id: "fake-observer",
        stream: async (request: unknown[]) => {
          requests.push(request);
          if (requests.length === failOnCall) throw new Error("synthetic observer failure");
          return {
            getFullOutput: async () => ({
              text: `<observations>\n- processed batch ${requests.length}\n</observations>`,
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }),
          };
        },
      }) as never,
  );
  return { om, requests };
}

describe("Mastra single-thread observer input patch", () => {
  test("keeps complete prior observations when the request fits", async () => {
    const { om, requests } = observerHarness();
    const prior = `oldest-fact ${"durable detail ".repeat(350)} newest-fact`;
    await om.observer.call(prior, [toolMessage(0, 1_000)] as never);
    expect(requests).toHaveLength(1);
    const prompt = JSON.stringify(requests[0]);
    expect(prompt).toContain("oldest-fact");
    expect(prompt).toContain("newest-fact");
  });

  test("batches complete tool results, bounds formatted requests, and cites omitted originals", async () => {
    const { om, requests } = observerHarness();
    const prior = `oldest-fact ${"durable detail ".repeat(350)} newest-fact`;
    const result = await om.observer.call(
      prior,
      Array.from({ length: 24 }, (_, i) => toolMessage(i)) as never,
    );

    expect(requests.length).toBeGreaterThan(1);
    const systemPrompt = om.observer.lastExchange?.systemPrompt;
    expect(systemPrompt).toBeTruthy();
    const serialized = requests.map((request) => JSON.stringify(request));
    expect(
      serialized.every(
        (request) => request.includes("oldest-fact") && request.includes("newest-fact"),
      ),
    ).toBe(true);
    for (const request of requests) {
      expect(
        Buffer.byteLength(JSON.stringify([systemPrompt, request]), "utf8"),
      ).toBeLessThanOrEqual(64 * 1024);
    }
    for (let i = 0; i < 24; i++) {
      expect(
        serialized.filter((request) => request.includes(`message-${i}, tool call call-${i}`)),
      ).toHaveLength(1);
    }
    expect(result.observations?.match(/processed batch/g)).toHaveLength(requests.length);
    expect(result.usage?.totalTokens).toBe(110 * requests.length);
  });

  test("a failed later batch does not return a successful partial observation", async () => {
    const { om, requests } = observerHarness(2);
    await expect(
      om.observer.call(undefined, Array.from({ length: 24 }, (_, i) => toolMessage(i)) as never),
    ).rejects.toThrow("synthetic observer failure");
    expect(requests).toHaveLength(2);
  });

  test("an indivisible oversized text message fails visibly without truncating it", async () => {
    const { om, requests } = observerHarness();
    const message = toolMessage(0);
    const textMessage = {
      ...message,
      content: { format: 2 as const, parts: [{ type: "text" as const, text: "x".repeat(70_000) }] },
    };
    await expect(om.observer.call("", [textMessage] as never)).rejects.toThrow(/message message-0/);
    expect(requests).toHaveLength(0);
  });
});
