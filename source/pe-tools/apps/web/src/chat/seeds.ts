/**
 * Chat seed data — plain values, no provider, no behaviour. `?demo=<action>` mounts one of these
 * through `useRoute`'s demo owner; nothing here renders or holds state.
 */
import type { MastraDBMessage } from "@mastra/client-js";
import type { Seed } from "@pe/agent-contracts";

import { emptyChatState, type ChatState } from "#/workbench/chat-state";

const at = (minute: number) => new Date(Date.UTC(2026, 7, 30, 19, minute));
const message = (
  id: string,
  role: "user" | "assistant",
  minute: number,
  parts: MastraDBMessage["content"]["parts"],
): MastraDBMessage => ({ id, role, createdAt: at(minute), content: { format: 2, parts } });
const tool = (
  toolCallId: string,
  toolName: string,
  args: unknown,
  result?: unknown,
): MastraDBMessage["content"]["parts"][number] =>
  ({
    type: "tool-invocation",
    toolInvocation: {
      state: result === undefined ? "call" : "result",
      step: 0,
      toolCallId,
      toolName,
      args,
      ...(result === undefined ? {} : { result }),
    },
  }) as MastraDBMessage["content"]["parts"][number];

export const CHAT_SEED_STATE: ChatState = {
  ...emptyChatState(),
  display: {
    isRunning: true,
    tasks: [
      {
        id: "plan-1",
        content: "Inspect the active mechanical view",
        activeForm: "Inspecting the active mechanical view",
        status: "completed",
      },
      {
        id: "plan-2",
        content: "Summarize visible systems and evidence",
        activeForm: "Summarizing visible systems and evidence",
        status: "completed",
      },
      {
        id: "plan-3",
        content: "Apply the reviewed schedule update",
        activeForm: "Applying the reviewed schedule update",
        status: "pending",
      },
    ],
    pendingApproval: {
      toolCallId: "tool-approval",
      toolName: "submit_plan",
      args: { title: "Level 2 coordination schedule" },
    },
    omProgress: {
      status: "observing",
      pendingTokens: 1840,
      threshold: 8000,
      observationTokens: 1240,
      reflectionThreshold: 16000,
      buffered: { observations: { status: "running" } },
    },
  },
  messages: [
    message("user-1", "user", 30, [
      { type: "text", text: "Inspect the active Level 2 mechanical view before we touch it." },
    ]),
    message("assistant-1", "assistant", 31, [
      {
        type: "reasoning",
        reasoning:
          "I need the current document and visible-category evidence before proposing a change.",
      } as MastraDBMessage["content"]["parts"][number],
      tool(
        "tool-read",
        "read_file",
        { path: "docs/coordination/level-2.md" },
        {
          lines: 38,
          systems: ["Supply Air", "Return Air", "Hydronic Supply"],
        },
      ),
      {
        type: "text",
        text: "The coordination brief names three systems and requires a bounded visible-model check.",
      },
    ]),
    message("user-2", "user", 33, [
      { type: "text", text: "Run the bounded check and keep the evidence with the result." },
    ]),
    message("assistant-2", "assistant", 34, [
      tool(
        "tool-receipt",
        "pe_read",
        { key: "op:revit.context.visible-summary" },
        {
          ok: true,
          key: "op:revit.context.visible-summary",
          revision: 3,
          target: { session: "pe.app-26", document: "C:\\Review\\Operations Demo.rvt" },
          receipt: "op-20260830-1842",
          activeView: "Level 2 HVAC Plan",
          visibleElements: 47,
          categories: 3,
          elapsedMs: 18,
        },
      ),
      {
        type: "text",
        text: "Receipt op-20260830-1842 captured 47 visible elements across Ducts, Duct Fittings, and Air Terminals.",
      },
    ]),
    message("user-3", "user", 36, [
      { type: "text", text: "Draft the schedule update, but ask before anything writes." },
    ]),
    message("assistant-3", "assistant", 37, [
      {
        type: "text",
        text: "The read-only evidence is complete. The schedule change is ready for your approval.",
      },
      tool("tool-approval", "submit_plan", {
        title: "Level 2 coordination schedule",
        plan: ["Add system totals", "Preserve existing sorting", "Write only after approval"],
      }),
    ]),
  ],
  inspect: {
    contextWindow: 32_000,
    systemPrompt: {
      source: "demo review",
      updatedAt: "2026-08-30T19:29:00.000Z",
      content: "You are Pea. Inspect evidence before writes and retain operation receipts.",
    },
    toolList: {
      tools: [
        { name: "read_file", description: "Read committed workspace files.", approxTokens: 180 },
        {
          name: "pe_do",
          description: "Do one capability by key from pe_find.",
          approxTokens: 260,
        },
        { name: "submit_plan", description: "Request approval for a plan.", approxTokens: 120 },
      ],
    },
    skills: [
      { name: "execute", description: "Choose and report the proof lane.", approxTokens: 90 },
      { name: "prove", description: "Test a claim against its falsifier.", approxTokens: 80 },
    ],
    agents: [{ name: "Pea", description: "Revit operator for Positive Energy workflows." }],
  },
  models: {
    currentId: "openai/gpt-5.6",
    available: [
      { id: "openai/gpt-5.6", modelName: "GPT-5.6", provider: "openai" },
      { id: "anthropic/claude-sonnet", modelName: "Claude Sonnet", provider: "anthropic" },
    ] as ChatState["models"]["available"],
  },
  access: "ask",
};

/** Threads the seed pretends exist, as the thread list reads them. */
export const CHAT_SEED_THREADS = [
  { id: "demo-review", title: "Level 2 coordination review", updatedAt: at(37).toISOString() },
  { id: "demo-followup", title: "Air terminal follow-up", updatedAt: at(12).toISOString() },
];

const HEAD = {
  defaultTarget: {
    kind: "named",
    session: "pe.app-26",
    address: "C:\Review\Operations Demo.rvt",
  },
  revision: 3,
};

const INVENTORY = {
  kind: "ready",
  sessions: {
    "pe.app-26": {
      kind: "ready",
      values: [{ id: "open-1", address: "C:\Review\Operations Demo.rvt" }],
    },
  },
};

/** One seed per action. The map is total: every action key has a moment. */
export const CHAT_SEEDS = {
  send: {
    title: "a prompt waiting to send",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: { text: "Draft the schedule update, but ask before anything writes.", attachments: [] },
  },
  cancel: {
    title: "pea mid-turn, with an approval owed",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: { text: "", attachments: [] },
  },
} satisfies Record<string, Seed<ChatState, "head" | "inventory" | "receipts", ChatPage>>;

/** The page the composer owns: draft text and its attachments. */
export interface ChatPage {
  text: string;
  attachments: unknown[];
}

/**
 * The caller a seeded chat runs against. `?demo=` has no socket and no turn to send, so the seed
 * names a caller that answers and does nothing; without one, chat's own `ready()` refuses
 * "Session is not ready" and the seed proves nothing it was written to prove. Demo lane only —
 * `chat-shell.tsx` hands it over exclusively when `?demo=` is in the search.
 */
export const CHAT_SEED_SESSION = {
  sendMessage: async () => undefined,
  abort: async () => undefined,
  approveTool: async () => undefined,
  respondToToolSuspension: async () => undefined,
};
