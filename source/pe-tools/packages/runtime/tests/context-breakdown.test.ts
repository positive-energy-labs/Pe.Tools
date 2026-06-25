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
    agents: [{ name: "Pea", description: "Test agent." }],
  });

  const byId = Object.fromEntries(breakdown.segments.map((s) => [s.id, s]));
  expect(byId.messages.tokens).toBe(30);
  expect(byId["system-prompt"].tokens).toBe(100);
  expect(byId.tools.tokens).toBe(50);
  // measured segments partition the window: total + free === window.
  expect(byId.free.tokens).toBe(1000 - (30 + 100 + 50));
  expect(breakdown.totalTokens).toBe(180);

  // skills/agents annotate the system prompt (not summed into the total).
  const agentItem = byId["system-prompt"].items?.find((i) => i.name === "agent · Pea");
  expect(agentItem?.body).toBe("Test agent."); // description is the expandable identity card
  // tools are listed individually, structured (name + src + tokens + state).
  const peStatus = byId.tools.items?.find((i) => i.name === "pe_status");
  expect(peStatus).toMatchObject({
    name: "pe_status",
    src: "runtime/tools",
    tokens: 30,
    state: "in",
  });
  // skills are their own segment, listed as on-demand cards.
  expect(byId.skills.items?.find((i) => i.name === "audit")?.state).toBe("on-demand");
});

test("splitSystemPrompt breaks the resolved prompt into section cards", () => {
  const breakdown = buildContextBreakdown({
    systemPromptText:
      "You are Pea.\n# Harness\nTools run behind permissions.\n# Environment\ncwd: /x",
  });
  const names = breakdown.segments.find((s) => s.id === "system-prompt")?.items?.map((i) => i.name);
  expect(names).toContain("Base identity");
  expect(names).toContain("Harness");
  expect(names).toContain("Environment");
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
