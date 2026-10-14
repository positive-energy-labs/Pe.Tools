/**
 * Chat seed data — plain values, no provider, no behaviour. `?demo=<action>` mounts one of these
 * through `useRoute`'s demo owner; nothing here renders or holds state. Each seed is a thread body
 * whose `events` are the harness log the host would have written.
 */
import {
  address,
  contributionSourcePath,
  documentRows,
  parseContributionKey,
  mentionOf,
  mentionToken,
  type Capability,
  type CapabilityCatalog,
  type HarnessEvent,
  type Mention,
  type PromptAttachment,
  type Seed,
} from "@pe/agent-contracts";
import { CHECKOUT_HOT, MACHINE_SEEDS } from "#/open/seeds";

import type { ChatReading } from "#/chat/manifest";
import { emptyChatState, type ChatState } from "@pe/agent-contracts/chat-state";

const at = (minute: number) => new Date(Date.UTC(2026, 7, 30, 19, minute));

/** A log from bare event bodies: `seq`, `at` and the turn id are filled in order. */
function log(
  ...bodies: (
    | { kind: "prompt"; text: string; attachments?: PromptAttachment[]; mentions?: Mention[] }
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
const think = (text: string) => ({
  kind: "update" as const,
  update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } },
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

/** A 96x60 PNG of a riser photo. */
const RISER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAA8CAIAAAAWtijjAAAAh0lEQVR4nO3YsQnAMBRDQe8/QGrXmS0Yj+ANEheBL/DBG0BcqfaMqZda+YLwAAECBAhQcJVAV793AgQIECBAgAABAgQIECBAgAABAvQn0ObKYwMECBAgQMEBAgQIEKDgAAECBKgUyB/08QcBAgQIECBAgAABAgQIECBAgAABAgQIECBAgDKAFi2h3G4k+qcoAAAAAElFTkSuQmCC";

const DUCT_SIZES_CSV =
  "run,cfm,velocity_fpm,size_in\nMain A,4800,1900,30x16\nBranch A1,2400,1500,20x14\nBranch A2,2400,1500,20x14\nMain B,3200,1700,24x16\nBranch B1,1600,1300,16x12\nBranch B2,1600,1300,16x12";

/** The composer's three kinds as they cross: an image block, an embedded text file, a linked PDF. */
const ATTACHED = {
  riser: { name: "riser.png", mimeType: "image/png", size: 192, data: RISER_PNG },
  sizes: {
    name: "duct-sizes.csv",
    mimeType: "text/csv",
    size: DUCT_SIZES_CSV.length,
    text: DUCT_SIZES_CSV,
  },
  submittal: {
    name: "damper-submittal.pdf",
    mimeType: "application/pdf",
    size: 184_320,
    data: "JVBERi0xLjcK",
  },
} satisfies Record<string, PromptAttachment>;

/** The user attaches a photo and a CSV, then a submittal PDF; the harness reads the linked file. */
const CHAT_ATTACH_STATE: ChatState = {
  ...THREAD,
  promptCapabilities: { image: true, embeddedContext: true },
  events: log(
    {
      kind: "prompt",
      text: "Is Branch B2 sized right?",
      attachments: [ATTACHED.riser, ATTACHED.sizes],
    },
    say(
      "The photo shows the riser dropping into Main B with a reducer at the first tee. " +
        "In duct-sizes.csv Branch B2 carries 1600 cfm at 1300 fpm in 16x12, the same as Branch B1, " +
        "so the size holds if the reducer in the photo is the only transition.",
    ),
    { kind: "turn_end", stopReason: "end_turn" },
    {
      kind: "prompt",
      text: "Here is the damper submittal. Does its pressure drop change that?",
      attachments: [ATTACHED.submittal],
    },
    tool("pdf", "Read", {
      file_path: "C:\\Pe\\threads\\demo-review\\attachments\\turn-2\\damper-submittal.pdf",
    }),
    done("pdf", "Ruskin CD50, 16x12: 0.04 in. w.g. at 1300 fpm."),
    say(
      "The submittal lists 0.04 in. w.g. across the damper at 1300 fpm. " +
        "That leaves Branch B2 inside its budget; 16x12 stands.",
    ),
    { kind: "turn_end", stopReason: "end_turn" },
  ),
};

/** What the harness advertises at session start; the composer's slash menu reads the latest. */
const SKILL_COMMANDS = {
  kind: "update" as const,
  update: {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      { name: "review-schedule", description: "Review a schedule for blanks, outliers and drift." },
      { name: "execute", description: "Choose and report the proof lane." },
      { name: "prove", description: "Test a claim against its falsifier." },
      { name: "docs", description: "Decide where durable knowledge lands." },
      { name: "compact", description: "Clear history but keep a summary." },
    ],
  },
};

/** The user types `/review-schedule`; Claude answers with its `Skill` tool, then works the skill. */
const CHAT_SKILL_STATE: ChatState = {
  ...THREAD,
  events: log(
    SKILL_COMMANDS,
    { kind: "prompt", text: "/review-schedule Mechanical Equipment Schedule" },
    tool("skill", "Skill", { skill: "review-schedule", args: "Mechanical Equipment Schedule" }),
    done("skill", "Launching skill: review-schedule"),
    tool("sched", "mcp__pea__pe_read", { key: "op:schedules.read" }),
    done("sched", { ok: true, key: "op:schedules.read", revision: 3, rows: 38, blanks: 4 }),
    think("Four blank marks out of 38; outliers are worth a second read before I summarize."),
    tool("find", "mcp__pea__pe_find", { query: "schedule outliers" }),
    done("find", { ok: true, matches: 2 }),
    think("Two matches. AHU-2 is the one to lead with."),
    tool("bash", "Bash", {
      command:
        "python -c \"import json;print(json.dumps(open(r'C:/Users/you/pea-tests/hcb/work/Census.json').read()))\"",
    }),
    done("bash", "Exit 0"),
    tool("apply", "mcp__pea__pe_do", { key: "op:schedules.apply", rows: [12, 13] }),
    done("apply", { error: true, message: "Schedule is locked by another user." }, "failed"),
    say(
      "Mechanical Equipment Schedule: 38 rows, 4 with a blank Mark. " +
        "AHU-2 lists 8000 cfm against a 4800 cfm main; check that row first.",
    ),
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

/** The same document, bound under a session the inventory no longer holds: a closed target. */
const CLOSED_HEAD = {
  defaultTarget: { kind: "named", session: "pe.app-25", address: DEMO_ADDRESS },
  revision: 4,
  displayLabel: "Operations Demo.rvt",
};

const machineSeed = MACHINE_SEEDS["controlled-hot"];
if (machineSeed.state !== "ready") throw new Error("Chat seed requires a ready Machine fixture");

/** `GET /pe/capabilities` as a hostless page sees it: the seed inventory's session, Revit's recent
 * documents and one row of each kind. No `doc:` or `recent:` rows: the `@` menu derives them. */
const CATALOG = {
  at: at(29).toISOString(),
  machine: {
    ...machineSeed.observation,
    revit: {
      years: [2026],
      unclassifiedAttachments: [],
      sessions: [
        {
          ...CHECKOUT_HOT,
          row: { ...CHECKOUT_HOT.row, year: 2026 },
          attachment: {
            session: "pe.app-26",
            pid: 2501,
            processStartUtcUnixMs: 0,
            documentIdentity: "sdk-open-v1",
            documents: [
              {
                session: "pe.app-26",
                openId: "open-1",
                title: "Operations Demo.rvt",
                address: DEMO_ADDRESS,
                isFamilyDocument: false,
                isActive: true,
                access: { kind: "read" },
              },
            ],
          },
        },
      ],
    },
  },
  recents: [
    recent(
      "Boiler Plant Retrofit",
      "C:\\Projects\\2611 Boiler Plant\\Boiler Plant Retrofit.rvt",
      1,
    ),
    recent(
      "MEP_Belmont_R26",
      "cld://US/{bd39078b-b752-475d-9de5-e542894a9eaa}Belmont%20Studio/{890eeb3d-5633-4964-be48-0aa4f686ed1d}MEP_Belmont_R26.rvt",
      2,
    ),
    recent("PE Duct Tag", "C:\\Standards\\Families\\Annotation\\PE Duct Tag.rfa", 3),
  ],
  sources: { ops: "ok", routes: "ok", pods: "ok", skills: "ok" },
  diagnostics: [],
  capabilities: [
    row(
      "skill:@product/skills/review-schedule",
      "skill",
      "review-schedule",
      "Review a schedule for blanks, outliers and drift.",
    ),
    row(
      "skill:@product/skills/build-pod",
      "skill",
      "build-pod",
      "Turn a working script into a Pod the user can press.",
    ),
    row(
      "route:schedules",
      "route-doc",
      "Schedules",
      "Read the Schedules document you co-edit with the user.",
    ),
    row(
      "route:schedules.apply",
      "route-command",
      "Schedules: apply",
      "Apply the reviewed schedule rows to Revit.",
    ),
    row(
      "op:revit.catalog.loaded-families",
      "op",
      "Loaded families",
      "List the families loaded in the open document.",
    ),
    row(
      "op:revit.context.open-views",
      "op",
      "Open views",
      "The views open in the active document, with their ids.",
    ),
    // Ops the live catalog titles by their key: the menu reads their description instead.
    row(
      "op:parameter-links.read",
      "op",
      "parameter-links.read",
      "Read the stored parameter-link profile and runtime status, and optionally evaluate the authored links.",
    ),
    row(
      "op:parameter-links.apply",
      "op",
      "parameter-links.apply",
      "Store the reviewed parameter-link draft and reconcile exactly the evaluated writes the human approved.",
    ),
    row(
      "op:takeoffs.initialize",
      "op",
      "takeoffs.initialize",
      "Write the shared parameters this document is missing before any takeoff runs.",
    ),
    row(
      "op:parameters.list",
      "op",
      "parameters.list",
      "List the parameters of the open document, with their groups and bindings.",
    ),
    row(
      "script:@sheets/src/Rename.cs",
      "script",
      "Sheets: rename",
      "Rename sheets from a pattern.",
    ),
  ],
} satisfies CapabilityCatalog;

function row(
  key: string,
  kind: Capability["kind"],
  title: string,
  description: string,
): Capability {
  const reference = parseContributionKey(key);
  return {
    key,
    kind,
    title,
    description,
    needs: kind === "op" || kind === "script" ? "document" : "nothing",
    mutates: kind === "route-command" || kind === "script",
    actor: "any",
    input: {},
    source: "seed",
    // A packaged row names its admitted entry, as the host's catalog does.
    ...(reference
      ? {
          package: {
            id: reference.packageId,
            path: contributionSourcePath(reference),
            sha256: "0".repeat(64),
          },
        }
      : {}),
    rank: 0,
  };
}

function recent(title: string, path: string, rank: number) {
  const cloud = /^cld:\/\/(\w+)\/\{([^}]+)\}[^/]*\/\{([^}]+)\}/.exec(path);
  return {
    title,
    path,
    isCloud: cloud !== null,
    region: cloud?.[1] ?? null,
    projectGuid: cloud?.[2] ?? null,
    modelGuid: cloud?.[3] ?? null,
    year: 2026,
    savedYear: cloud ? null : 2026,
    rank,
  };
}

const byKey = (key: string) => CATALOG.capabilities.find((found) => found.key === key)!;
const MENTIONED = [
  mentionOf(documentRows(CATALOG)[0]!, CATALOG),
  mentionOf(byKey("skill:@product/skills/review-schedule"), CATALOG),
];

/** The user points at a document and a skill with `@`; Pea's first hop uses the ids the mention
 * carried, no search. */
const CHAT_MENTION_STATE: ChatState = {
  ...THREAD,
  events: log(
    {
      kind: "prompt",
      text: `Run ${mentionToken(MENTIONED[1]!)} over the mechanical schedules in ${mentionToken(MENTIONED[0]!)}.`,
      mentions: MENTIONED,
    },
    tool("read", "mcp__pea__pe_read", {
      key: "op:schedules.read",
      target: { session: "pe.app-26", openId: "open-1" },
    }),
    done("read", { ok: true, key: "op:schedules.read", revision: 3, rows: 38, blanks: 4 }),
    say(
      "Read pe.app-26/open-1 (Operations Demo.rvt) straight from your mention: " +
        "the Mechanical Equipment Schedule has 38 rows, 4 with a blank Mark. " +
        "Following review-schedule, AHU-2 is the outlier to check first.",
    ),
    { kind: "turn_end", stopReason: "end_turn" },
  ),
};

const READINGS = { head: HEAD, machine: CATALOG.machine, receipts: [], capabilities: CATALOG };

/** One seed per action. The map is total: every action key has a moment. */
export const CHAT_SEEDS = {
  send: {
    title: "an idle thread ready for a prompt",
    work: CHAT_SEED_STATE,
    readings: READINGS,
    page: {},
  },
  new: {
    title: "a thread to leave for a fresh one",
    work: CHAT_SEED_STATE,
    readings: READINGS,
    page: {},
  },
  diagram: {
    title: "pea drew a duct system, after one rejected diagram call",
    work: CHAT_DIAGRAM_STATE,
    readings: READINGS,
    page: {},
  },
  attach: {
    title: "the user attached a photo, a CSV and a PDF; pea read all three",
    work: CHAT_ATTACH_STATE,
    readings: READINGS,
    page: {},
  },
  skill: {
    title: "the user ran a slash skill; the harness advertised its commands",
    work: CHAT_SKILL_STATE,
    readings: READINGS,
    page: {},
  },
  mention: {
    title: "the user mentioned a document and a skill with @; pea used their ids",
    work: CHAT_MENTION_STATE,
    readings: READINGS,
    page: {},
  },
  closed: {
    title: "a thread whose bound session has closed; send refuses until a live document is chosen",
    work: CHAT_ATTACH_STATE,
    readings: { ...READINGS, head: CLOSED_HEAD },
    page: {},
  },
  granted: {
    title: "a human pointed the thread at a document; the host reads rw for 42 more minutes",
    work: CHAT_SEED_STATE,
    readings: {
      ...READINGS,
      head: { ...HEAD, hostNow: at(0).toISOString(), grantView: { state: "rw", minutes: 42 } },
    },
    page: {},
  },
  stop: {
    title: "pea mid-turn, with an approval owed",
    work: CHAT_SEED_STATE,
    readings: READINGS,
    page: {},
  },
} satisfies Record<string, Seed<ChatState, ChatReading, ChatPage>>;

/** Chat's draft belongs to `createChatPageStore`; the route manifest owns no Page fields. */
export type ChatPage = Record<string, never>;
