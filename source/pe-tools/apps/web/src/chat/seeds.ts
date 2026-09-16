/**
 * Chat seed data — plain values, no provider, no behaviour. `?demo=<action>` mounts one of these
 * through `useRoute`'s demo owner; nothing here renders or holds state.
 */
import type { MastraDBMessage } from "@mastra/client-js";
import { address, type Seed } from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";

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

/** A duct system as pea passes it to the `diagram` tool: AHU, two mains, four branches, VAVs. */
const DUCT_DIAGRAM_ARGS = {
  title: "AHU-1 supply air",
  direction: "LR",
  nodes: [
    { id: "AHU1", label: "AHU-1\n8000 cfm", shape: "stadium" },
    { id: "M1", label: "Main A" },
    { id: "M2", label: "Main B" },
    { id: "B1", label: "Branch A1" },
    { id: "B2", label: "Branch A2" },
    { id: "B3", label: "Branch B1" },
    { id: "B4", label: "Branch B2" },
    { id: "V1", label: "VAV A1-1", shape: "round" },
    { id: "V2", label: "VAV A2-1", shape: "round" },
    { id: "V3", label: "VAV B1-1", shape: "round" },
    { id: "V4", label: "VAV B2-1", shape: "round" },
  ],
  edges: [
    { from: "AHU1", to: "M1", label: "4800 cfm", style: "thick" },
    { from: "AHU1", to: "M2", label: "3200 cfm", style: "thick" },
    { from: "M1", to: "B1", label: "2400 cfm" },
    { from: "M1", to: "B2", label: "2400 cfm" },
    { from: "M2", to: "B3", label: "1600 cfm" },
    { from: "M2", to: "B4", label: "1600 cfm", style: "dashed" },
    { from: "B1", to: "V1", label: "2400 cfm" },
    { from: "B2", to: "V2", label: "2400 cfm" },
    { from: "B3", to: "V3", label: "1600 cfm" },
    { from: "B4", to: "V4", label: "1600 cfm" },
  ],
  groups: [
    { id: "mainA", label: "Main A", nodes: ["M1", "B1", "B2", "V1", "V2"] },
    { id: "mainB", label: "Main B", nodes: ["M2", "B3", "B4", "V3", "V4"] },
  ],
};

/** Mastra keeps a rejected call as a `result` whose value is the validation error. */
const DIAGRAM_REJECTED = {
  error: true,
  message:
    'Tool input validation failed for diagram. Please fix the following errors and try again:\n- nodes.1.id: duplicate id "AHU"\n- edges.3.to: no node "VAV-9"',
};

/** Pea drew once with a bad spec (rejected, nothing drawn), then drew the duct system. */
export const CHAT_DIAGRAM_STATE: ChatState = {
  ...emptyChatState(),
  messages: [
    message("user-d1", "user", 40, [
      { type: "text", text: "Sketch the AHU-1 supply duct system with airflow on each run." },
    ]),
    message("assistant-d1", "assistant", 41, [
      tool(
        "diagram-bad",
        "diagram",
        {
          nodes: [
            { id: "AHU", label: "AHU-1" },
            { id: "AHU", label: "Main A" },
          ],
          edges: [
            { from: "AHU", to: "AHU" },
            { from: "AHU", to: "AHU" },
            { from: "AHU", to: "AHU" },
            { from: "AHU", to: "VAV-9" },
          ],
        },
        DIAGRAM_REJECTED,
      ),
      tool("diagram-ok", "diagram", DUCT_DIAGRAM_ARGS, {
        ok: true,
        nodes: 11,
        edges: 10,
        groups: 2,
      }),
      {
        type: "text",
        text: "AHU-1 splits 60/40 across the two mains; Branch B2 is still planned.",
      },
    ]),
  ],
  models: CHAT_SEED_STATE.models,
  inspect: CHAT_SEED_STATE.inspect,
};

/** Threads the seed pretends exist, as the thread list reads them. */
export const CHAT_SEED_THREADS = [
  { id: "demo-review", title: "Level 2 coordination review", updatedAt: at(37).toISOString() },
  { id: "demo-followup", title: "Air terminal follow-up", updatedAt: at(12).toISOString() },
];

const DEMO_ADDRESS = address("C:\\Review\\Operations Demo.rvt");

const HEAD = {
  defaultTarget: {
    kind: "named",
    session: "pe.app-26",
    address: DEMO_ADDRESS,
  },
  revision: 3,
};

const INVENTORY = {
  sessions: [
    {
      sessionId: "pe.app-26",
      connected: true,
      openDocumentCount: 1,
      openDocuments: [
        {
          openId: "open-1",
          title: "Operations Demo.rvt",
          address: DEMO_ADDRESS,
          isFamilyDocument: false,
          isActive: true,
        },
      ],
    },
  ],
} satisfies { sessions: readonly BridgeSessionListEntry[] };

/** One seed per action. The map is total: every action key has a moment. */
export const CHAT_SEEDS = {
  send: {
    title: "an idle thread ready for a prompt",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: {},
  },
  new: {
    title: "a thread to leave for a fresh one",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: {},
  },
  fork: {
    title: "a thread to clone before trying another path",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: {},
  },
  diagram: {
    title: "pea drew a duct system, after one rejected diagram call",
    work: CHAT_DIAGRAM_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: {},
  },
  cancel: {
    title: "pea mid-turn, with an approval owed",
    work: CHAT_SEED_STATE,
    readings: { head: HEAD, inventory: INVENTORY, receipts: [] },
    page: {},
  },
} satisfies Record<string, Seed<ChatState, "head" | "inventory" | "receipts", ChatPage>>;

/** Chat's draft belongs to `createChatPageStore`; the route manifest owns no Page fields. */
export type ChatPage = Record<string, never>;
