/**
 * Chat seed data — plain values, no provider, no behaviour. `?demo=<action>` mounts one of these
 * through `useRoute`'s demo owner; nothing here renders or holds state. Each seed is a thread body
 * whose `events` are the harness log the host would have written.
 */
import { address, type HarnessEvent, type Seed } from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";

import { emptyChatState, type ChatState } from "#/workbench/chat-state";

const at = (minute: number) => new Date(Date.UTC(2026, 7, 30, 19, minute));

/** A log from bare event bodies: `seq`, `at` and the turn id are filled in order. */
function log(
  ...bodies: (
    | { kind: "prompt"; text: string }
    | { kind: "update"; update: { sessionUpdate: string; [key: string]: unknown } }
    | Omit<Extract<HarnessEvent, { kind: "permission_request" }>, "seq" | "at" | "turnId">
    | { kind: "turn_end"; stopReason: string }
  )[]
): HarnessEvent[] {
  let turn = 0;
  return bodies.map((body, index) => {
    if (body.kind === "prompt") turn += 1;
    return { ...body, seq: index + 1, at: at(30 + index).toISOString(), turnId: `turn-${turn}` };
  }) as HarnessEvent[];
}

const say = (text: string) => ({
  kind: "update" as const,
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
});
const tool = (toolCallId: string, name: string, rawInput: unknown, status = "pending") => ({
  kind: "update" as const,
  update: { sessionUpdate: "tool_call", toolCallId, title: name, kind: "other", status, rawInput },
});
const done = (toolCallId: string, rawOutput: unknown, status = "completed") => ({
  kind: "update" as const,
  update: { sessionUpdate: "tool_call_update", toolCallId, status, rawOutput },
});

const THREAD = {
  ...emptyChatState(),
  id: "demo-review",
  title: "Level 2 coordination review",
  createdAt: at(30).toISOString(),
  updatedAt: at(37).toISOString(),
  modelId: "claude-sonnet",
  models: [
    { modelId: "claude-sonnet", name: "Claude Sonnet" },
    { modelId: "claude-opus", name: "Claude Opus" },
  ],
  session: "started",
} satisfies ChatState;

/** Pea mid-turn: evidence read, a plan in flight, and a write waiting on a permission. */
export const CHAT_SEED_STATE: ChatState = {
  ...THREAD,
  running: true,
  events: log(
    { kind: "prompt", text: "Inspect the active Level 2 mechanical view before we touch it." },
    {
      kind: "update",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: {
          type: "text",
          text: "I need the current document and visible-category evidence before proposing a change.",
        },
      },
    },
    tool("tool-receipt", "mcp__pea__pe_read", { key: "op:revit.context.visible-summary" }),
    done("tool-receipt", {
      ok: true,
      key: "op:revit.context.visible-summary",
      revision: 3,
      target: { session: "pe.app-26", document: "C:ReviewOperations Demo.rvt" },
      receipt: "op-20260830-1842",
      visibleElements: 47,
    }),
    say("Receipt op-20260830-1842 captured 47 visible elements "),
    say("across Ducts, Duct Fittings, and Air Terminals."),
    { kind: "turn_end", stopReason: "end_turn" },
    { kind: "prompt", text: "Draft the schedule update, but ask before anything writes." },
    {
      kind: "update",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Inspect the active mechanical view", priority: "high", status: "completed" },
          { content: "Summarize visible systems", priority: "medium", status: "completed" },
          { content: "Apply the reviewed schedule update", priority: "high", status: "pending" },
        ],
      },
    },
    {
      kind: "update",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "execute", description: "Choose and report the proof lane." },
          { name: "prove", description: "Test a claim against its falsifier." },
        ],
      },
    },
    { kind: "update", update: { sessionUpdate: "usage_update", used: 9_400, size: 200_000 } },
    say("The read-only evidence is complete. The schedule change is ready for your approval."),
    tool("tool-write", "mcp__pea__pe_do", { key: "op:schedules.apply" }),
    {
      kind: "permission_request",
      requestId: "ask-1",
      toolCall: { toolCallId: "tool-write" },
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    },
  ),
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

/** The tool refused the spec: its output is the validation error. */
const DIAGRAM_REJECTED = {
  error: true,
  message:
    'Tool input validation failed for diagram. Please fix the following errors and try again:\n- nodes.1.id: duplicate id "AHU"\n- edges.3.to: no node "VAV-9"',
};

/** Pea drew once with a bad spec (rejected, nothing drawn), then drew the duct system. */
const CHAT_DIAGRAM_STATE: ChatState = {
  ...THREAD,
  events: log(
    { kind: "prompt", text: "Sketch the AHU-1 supply duct system with airflow on each run." },
    tool("diagram-bad", "mcp__pea__diagram", {
      nodes: [
        { id: "AHU", label: "AHU-1" },
        { id: "AHU", label: "Main A" },
      ],
      edges: [{ from: "AHU", to: "VAV-9" }],
    }),
    done("diagram-bad", DIAGRAM_REJECTED, "failed"),
    tool("diagram-ok", "mcp__pea__diagram", DUCT_DIAGRAM_ARGS),
    done("diagram-ok", { ok: true, nodes: 11, edges: 10, groups: 2 }),
    say("AHU-1 splits 60/40 across the two mains; Branch B2 is still planned."),
    { kind: "turn_end", stopReason: "end_turn" },
  ),
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
