import { expect, test } from "vite-plus/test";
import { buildContextBreakdown, estimateTokens } from "../src/context-breakdown.ts";

test("buildContextBreakdown partitions the window and lists named contents", () => {
  const breakdown = buildContextBreakdown({
    contextWindow: 1000,
    systemPromptText: "x".repeat(400), // 100 tok
    tools: [
      { name: "pe_status", approxTokens: 30 },
      { name: "workspace_read", approxTokens: 20 },
    ],
    messages: [
      { role: "user", text: "y".repeat(40) }, // 10 tok
      { role: "assistant", text: "z".repeat(80) }, // 20 tok
    ],
    skills: [{ name: "audit", approxTokens: 420 }],
    agents: ["Pea"],
  });

  const byId = Object.fromEntries(breakdown.segments.map((s) => [s.id, s]));
  expect(byId.messages.tokens).toBe(30);
  expect(byId["system-prompt"].tokens).toBe(100);
  expect(byId.tools.tokens).toBe(50);
  // measured segments partition the window: total + free === window.
  expect(byId.free.tokens).toBe(1000 - (30 + 100 + 50));
  expect(breakdown.totalTokens).toBe(180);

  // skills/agents annotate the system prompt (not summed into the total).
  expect(byId["system-prompt"].items).toContain("agent · Pea");
  expect(byId.tools.items).toContain("pe_status · ~30 tok");
});

test("estimateTokens is char/4, rounded up", () => {
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
  expect(estimateTokens(undefined)).toBe(0);
});

test("buildContextBreakdown omits the free bar when the window is unknown", () => {
  const breakdown = buildContextBreakdown({ messages: [{ role: "user", text: "abcd" }] });
  expect(breakdown.contextWindow).toBeUndefined();
  expect(breakdown.segments.some((s) => s.id === "free")).toBe(false);
});
