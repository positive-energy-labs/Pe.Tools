import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import { classifyEndpointFailure } from "./endpoint-failure.ts";
import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ClientSideConnection,
  type ContentBlock,
  PROTOCOL_VERSION,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import {
  attachmentKind,
  attachmentRefusal,
  createThreadRequestSchema,
  emptyThreadLifecycle,
  threadLifecycleSchema,
  updateThreadRequestSchema,
  forkThreadRequestSchema,
  permissionResponseSchema,
  promptRequestSchema,
  putTargetSchema,
  questionResponseSchema,
  threadHeadSchema,
  traitRequestSchema,
  type HarnessEvent,
  type HarnessThreadBody,
  type HarnessThreadSummary,
  type Mention,
  type PromptAttachment,
  type PutTargetResult,
  type ThreadHead,
  type ThreadHeadReading,
  type Caller,
  emptyThreadHead,
} from "@pe/agent-contracts";
import { HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import {
  currentCaller,
  emitRevoke,
  grantExpiry,
  grantDead,
  mintContext,
  Refused,
  requireHuman,
  retireContext,
  documentAcquisition,
  sessionAcquisition,
} from "../control.ts";
import { Effect } from "effect";
import { z } from "zod";
import { openAdapter, stopChild } from "./adapter.ts";
import { accessModes, sessionOffer, type Providers } from "./providers.ts";
import { exportThread } from "../thread-export.ts";

/** The thread wire of ADR 0015; contract and route list in `@pe/agent-contracts` `harness-thread.ts`. */

type Meta = Omit<HarnessThreadSummary, "lastSeq" | "activity"> & {
  acpSessionId: string | null;
  models: HarnessThreadBody["models"];
  traits: HarnessThreadBody["traits"];
  /** Trait values the user chose, re-applied when a session comes back with the harness default. */
  traitValues: Record<string, string | boolean>;
  /** The thread head the Pea MCP child reads through `GET /pe/scope/:id`. */
  head: ThreadHead;
  /** The thread this one was forked from; `acpSessionId` is null when the fork crossed providers. */
  forkOf: { threadId: string; acpSessionId: string | null } | null;
  /** What the last `initialize` advertised; the attachment refusal reads it before a child runs. */
  promptCapabilities: HarnessThreadBody["promptCapabilities"];
};
type Live = { conn: ClientSideConnection; sessionId: string; configOptions: SessionConfigOption[] };
type Pending<R> = { turnId: string | null; resolve: (response: R) => void };
type Thread = {
  meta: Meta;
  child: ChildProcess | null;
  events: HarnessEvent[];
  live: Promise<Live> | null;
  /** The log as text, carried by the next prompt when the session is new over an existing log. */
  refeed: string | null;
  session: HarnessThreadBody["session"];
  /** Set by delete or host shutdown: the turn in flight stops logging. */
  stopped: boolean;
  running: string | null;
  /** Settles when the running turn has logged its end; an interrupting prompt waits on it. */
  turn: Promise<void>;
  pending: Map<string, Pending<RequestPermissionResponse>>;
  questions: Map<string, Pending<CreateElicitationResponse>>;
  listeners: Set<(event: HarnessEvent) => void>;
  /** The turn marker's clock: re-armed by every session update, cleared at turn end. */
  waiting: ReturnType<typeof setTimeout> | null;
  lastUpdateAt: number;
  idle: ReturnType<typeof setTimeout> | null;
  busy: number;
  retiring: Promise<void> | null;
  attention: HarnessThreadSummary["activity"];
  asks: Set<string>;
};
type Append = HarnessEvent extends infer E
  ? E extends HarnessEvent
    ? Omit<E, "seq" | "at">
    : never
  : never;

export type HarnessThreadsOptions = {
  /** State directory holding one directory per thread. */
  root: string;
  /** The harness child's cwd: the Pea world root. */
  worldRoot: string;
  /** The Pea MCP server the child launches, bound to its thread by the `PE_CONTEXT` token. */
  mcpServer: (context: string) => {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  };
  /** The Pea kernel for a harness that does not read MCP instructions (Codex); read per spawn. */
  developerInstructions?: () => Promise<string>;
  /** Providers: the child's auth env, the access setting, and the keys a record never keeps. */
  providers: Providers;
  /** Automatic update admission excludes new harness work through installer handoff. */
  updatePending?: () => boolean;
  /** Admission/import and skill publication must settle before either harness starts. */
  prepare?: () => Promise<unknown>;
  /** Called only after the transcript owner commits this fact. No prompt or tool text is exported. */
  receiptFact?: (threadId: string, title: string, event: HarnessEvent) => void;
};

/** A turn with no session update for this long gets a `waiting` marker, and again each period. */
export const WAITING_MS = 60_000;
export const IDLE_CHILD_MS = 15 * 60_000;
/** How long a prompt waits for the turn it interrupts to end before refusing. */
export const INTERRUPT_MS = 10_000;
/** Thrown by `input` on a body route sent without a JSON content type; served as 415. */
class NotJson extends Error {}
const warn = (message: string) => Effect.runSync(Effect.logWarning(message));

/**
 * Codex reads `developer_instructions` from its config, and that is the only instruction door this
 * wire reaches: Codex ignores an MCP server's `instructions` (canary 2026-10-04: a child called the
 * canary's tool and still did not know its secret word), so the Pea kernel rides here for Codex and
 * in the MCP instructions for Claude, which does read them. The question rule is Codex-only: asked
 * for an answer in `agent` mode, Codex otherwise delivers the question as an async message and sleeps
 * 60 s in a loop until cancelled, and codex-acp forwards none of it (repro `.artifacts/tmp/codex-ask-repro*`).
 * In plan mode Codex has `request_user_input`, which codex-acp turns into the question card.
 */
const CODEX_QUESTION_RULE =
  "You are running inside Pea, a chat surface. When you need an answer from the user: if the request_user_input tool is available, call it and wait for its result; otherwise write the question as your final message and end your turn, and the answer arrives as the next user message. Never use async message delivery, never call the sleep tool, and never wait inside a turn.";

/**
 * The provider's complete child environment (the user's shell PATH and its auth source),
 * and for Codex its developer instructions. The user's own Codex MCP servers are kept out by the
 * project-level config the routes write in the world root, never here: codex-acp replaces a
 * CODEX_CONFIG `mcp_servers`.
 */
async function childEnv(
  record: NonNullable<ReturnType<Providers["get"]>>,
  options: HarnessThreadsOptions,
  modelId?: string | null,
): Promise<NodeJS.ProcessEnv> {
  const env = await options.providers.env(record, modelId);
  env.PYTHONIOENCODING ??= "utf-8";
  if (record.harness !== "codex") return env;
  const config = env.CODEX_CONFIG ? (JSON.parse(env.CODEX_CONFIG) as object) : {};
  const developer_instructions = [await options.developerInstructions?.(), CODEX_QUESTION_RULE]
    .filter(Boolean)
    .join("\n\n");
  env.CODEX_CONFIG = JSON.stringify({ ...config, developer_instructions });
  return env;
}

/** The log as the model saw it: the user's prompts and answers, Pea's words and questions, no tool
 * traffic. Newest kept. */
const REFEED_CHARS = 24_000;
function transcript(events: HarnessEvent[]): string {
  const lines: string[] = [];
  let said = "";
  const flush = () => {
    if (said.trim()) lines.push(`Pea: ${said.trim()}`);
    said = "";
  };
  const asked = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "prompt") {
      flush();
      const names = e.attachments?.map((a) => a.name).join(", ");
      const keys = e.mentions?.map((m) => m.key).join(", ");
      lines.push(
        `User: ${e.text}${names ? ` [attached: ${names}]` : ""}${keys ? ` [mentioned: ${keys}]` : ""}`,
      );
    } else if (e.kind === "update" && e.update.sessionUpdate === "agent_message_chunk") {
      const content = (e.update as { content?: { type?: string; text?: string } }).content;
      if (content?.type === "text" && content.text) said += content.text;
    } else if (e.kind === "question_request") {
      flush();
      asked.set(e.requestId, e.message);
      lines.push(`Pea asked: ${e.message}`);
    } else if (e.kind === "question_resolved") {
      flush();
      lines.push(
        e.by === "user" && e.action === "accept"
          ? `User answered: ${JSON.stringify(e.content ?? {})}`
          : `User did not answer (${e.by === "user" ? "skipped" : e.by}).`,
      );
    }
  }
  flush();
  const body = lines.join("\n\n");
  const kept = body.length > REFEED_CHARS ? `…${body.slice(-REFEED_CHARS)}` : body;
  return `[Pea resumed this thread from its own record; the earlier harness session is gone. The transcript so far, oldest first. Continue from it; do not repeat it.]\n\n${kept}\n\n[End of transcript.]`;
}

/** A mention for a harness that reads no embedded context: one line, the pointer and its facts. */
const mentionLine = (m: Mention) =>
  `[@${m.title} → ${m.key}, ${Object.entries(m.facts)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ")}, taken ${m.takenAt}]`;

/**
 * The prompt as ACP content (mined from the Mastra path, `47c37fb2^:ts/packages/runtime/src/
 * message-contents.ts`: images as images, text files as labelled text, other files as files): an
 * image is an `image` block, a text file an embedded `resource`, any other file is written to `dir`
 * and linked, because claude-agent-acp drops resource blobs and codex-acp inlines them as base64.
 * Each mention follows the text as one embedded `pe://<key>` JSON resource, or as a text line when
 * the harness reads no embedded context; a mention is never refused.
 */
function promptBlocks(
  dir: string,
  text: string,
  attachments: PromptAttachment[] = [],
  mentions: Mention[] = [],
  embeddedContext = false,
) {
  const blocks: ContentBlock[] = text ? [{ type: "text", text }] : [];
  for (const m of mentions)
    blocks.push(
      embeddedContext
        ? {
            type: "resource",
            resource: {
              uri: `pe://${m.key}`,
              mimeType: "application/json",
              text: JSON.stringify(m),
            },
          }
        : { type: "text", text: mentionLine(m) },
    );
  for (const a of attachments) {
    const kind = attachmentKind(a);
    if (kind === "image") blocks.push({ type: "image", data: a.data!, mimeType: a.mimeType });
    else if (kind === "text")
      blocks.push({
        type: "resource",
        resource: {
          uri: `file:///${encodeURIComponent(a.name)}`,
          mimeType: a.mimeType,
          text: a.text!,
        },
      });
    else {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, basename(a.name));
      writeFileSync(path, Buffer.from(a.data!, "base64"));
      blocks.push({
        type: "resource_link",
        uri: pathToFileURL(path).href,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
      });
    }
  }
  return blocks;
}

/** tmp + rename, so a crash mid-write never leaves a torn file. */
function writeJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

export function createHarnessThreads(options: HarnessThreadsOptions) {
  const threads = new Map<string, Thread>();
  const headListeners = new Set<(threadId: string, head: ThreadHead) => void>();
  const headTimers = new Set<ReturnType<typeof setInterval>>();
  const summaryListeners = new Set<() => void>();
  const notifySummaries = () => {
    for (const listener of summaryListeners) listener();
  };
  /** Heads of ids that are not harness threads: an MCP child or the web may name a thread first. */
  const headsDir = join(options.root, ".heads");
  mkdirSync(headsDir, { recursive: true });
  for (const id of readdirSync(options.root)) {
    const dir = join(options.root, id);
    if (!existsSync(join(dir, "meta.json"))) continue;
    try {
      const events = existsSync(join(dir, "events.jsonl"))
        ? readFileSync(join(dir, "events.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as HarnessEvent)
        : [];
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
      meta.head = threadHeadSchema.safeParse(meta.head ?? emptyThreadHead).data ?? emptyThreadHead;
      meta.lifecycle = threadLifecycleSchema.parse(meta.lifecycle ?? emptyThreadLifecycle());
      meta.forkOf ??= null;
      meta.promptCapabilities ??= null;
      // Threads from before providers ran on the harness's own login.
      meta.providerId ??= meta.harness;
      meta.providerName ??= options.providers.get(meta.harness)?.name ?? meta.harness;
      meta.traits ??= [];
      meta.traitValues ??= {};
      threads.set(id, fresh(meta, events));
    } catch (error) {
      warn(`harness thread ${dir} skipped: it does not parse (${String(error)})`);
    }
  }

  function fresh(meta: Meta, events: HarnessEvent[] = []): Thread {
    const t: Thread = {
      meta,
      child: null,
      events,
      live: null,
      refeed: null,
      session: "closed",
      stopped: false,
      running: null,
      turn: Promise.resolve(),
      pending: new Map(),
      questions: new Map(),
      listeners: new Set(),
      waiting: null,
      lastUpdateAt: 0,
      idle: null,
      busy: 0,
      retiring: null,
      attention: { state: "idle", pending: 0, lastSeq: 0, message: null },
      asks: new Set(),
    };
    for (const event of events) projectActivity(t, event);
    return t;
  }

  /** A new thread on disk, spawned now so the model and trait pickers fill before the first prompt. */
  function create(meta: Meta, events: HarnessEvent[] = []): Thread {
    const t = fresh(meta, events);
    mkdirSync(join(options.root, meta.id), { recursive: true });
    writeMeta(t);
    writeFileSync(
      join(options.root, meta.id, "events.jsonl"),
      events.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
    threads.set(meta.id, t);
    notifySummaries();
    ensure(t).catch(() => {}); // a failure to start is an `error` event
    return t;
  }

  const writeMeta = (t: Thread) => writeJson(join(options.root, t.meta.id, "meta.json"), t.meta);

  function append(t: Thread, event: Append): HarnessEvent {
    const line = JSON.stringify({
      ...event,
      seq: t.events.length + 1,
      at: new Date().toISOString(),
    });
    // No endpoint key lands in a thread record, even when a harness echoes it.
    const redacted = options.providers
      .keys()
      .reduce((text, key) => text.replaceAll(key, `…${key.slice(-4)}`), line);
    const full = JSON.parse(redacted) as HarnessEvent;
    t.events.push(full);
    projectActivity(t, full);
    appendFileSync(join(options.root, t.meta.id, "events.jsonl"), `${redacted}\n`);
    options.receiptFact?.(t.meta.id, t.meta.title, full);
    if (
      ["turn_end", "error", "permission_request", "question_request"].includes(full.kind) &&
      t.meta.lifecycle.snoozedUntil &&
      full.seq > t.meta.lifecycle.snoozedSeq
    ) {
      t.meta.lifecycle.snoozedUntil = null;
      t.meta.lifecycle.status = "active";
      t.meta.lifecycle.reopenedAt = full.at;
      t.meta.lifecycle.revision++;
      writeMeta(t);
    }
    for (const listener of t.listeners) listener(full);
    if (full.kind !== "update" || full.update.sessionUpdate === "config_option_update")
      notifySummaries();
    return full;
  }

  function isActivity(event: HarnessEvent) {
    return (
      [
        "prompt",
        "turn_end",
        "error",
        "permission_request",
        "question_request",
        "permission_resolved",
        "question_resolved",
      ].includes(event.kind) ||
      (event.kind === "update" &&
        ["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update"].includes(
          String(event.update.sessionUpdate),
        ))
    );
  }

  function activity(t: Thread): HarnessThreadSummary["activity"] {
    return { ...t.attention };
  }
  function projectActivity(t: Thread, event: HarnessEvent) {
    const value = t.attention;
    if (event.kind !== "update" && isActivity(event)) value.lastSeq = event.seq;
    if (event.kind === "prompt") {
      value.state = "running";
      value.message = null;
    }
    if (event.kind === "turn_end" || event.kind === "error") {
      value.state = event.kind === "error" ? "failed" : "idle";
      value.message = event.kind === "error" ? event.message : null;
    }
    if (event.kind === "permission_request" || event.kind === "question_request")
      t.asks.add(event.requestId);
    if (event.kind === "permission_resolved" || event.kind === "question_resolved")
      t.asks.delete(event.requestId);
    value.pending = t.asks.size;
    if (value.pending) value.state = "waiting";
    else if (event.kind === "permission_resolved" || event.kind === "question_resolved")
      value.state = t.running ? "running" : "idle";
  }

  const summary = (t: Thread): HarnessThreadSummary => ({
    id: t.meta.id,
    harness: t.meta.harness,
    providerId: t.meta.providerId,
    providerName: t.meta.providerName,
    title: t.meta.title,
    createdAt: t.meta.createdAt,
    updatedAt: t.events.at(-1)?.at ?? t.meta.updatedAt,
    modelId: t.meta.modelId,
    lastSeq: t.events.length,
    head: t.meta.head,
    lifecycle: t.meta.lifecycle,
    activity: activity(t),
  });

  const body = (t: Thread): HarnessThreadBody => ({
    ...summary(t),
    models: t.meta.models,
    traits: t.meta.traits,
    running: t.running !== null,
    session: t.session,
    promptCapabilities: t.meta.promptCapabilities,
    events: t.events,
  });

  /* ── The thread head: `meta.head` on a harness thread, else `.heads/<sha256>.json` ── */

  const headFile = (threadId: string) =>
    join(headsDir, `${createHash("sha256").update(threadId).digest("hex")}.json`);

  function readHead(threadId: string): ThreadHead {
    const t = threads.get(threadId);
    if (t) return t.meta.head;
    const file = headFile(threadId);
    if (!existsSync(file)) return emptyThreadHead;
    const parsed = threadHeadSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) warn(`thread head ${threadId}: stored head no longer parses`);
    return parsed.data ?? emptyThreadHead;
  }
  const reading = (head: ThreadHead): ThreadHeadReading => {
    const now = Date.now();
    const dead = head.grant && grantDead(head.grant, now);
    return {
      ...head,
      hostNow: new Date(now).toISOString(),
      grantView: !head.grant
        ? null
        : dead === "grant.revoked"
          ? { state: "revoked" }
          : dead === "grant.expired"
            ? { state: "expired" }
            : {
                state: "rw",
                minutes: Math.ceil((Date.parse(head.grant.expiresAt) - now) / 60_000),
              },
    };
  };
  function writeHead(threadId: string, head: ThreadHead) {
    const t = threads.get(threadId);
    if (t) {
      t.meta.head = head;
      writeMeta(t);
    } else writeJson(headFile(threadId), head);
    for (const listener of headListeners) listener(threadId, head);
    notifySummaries();
  }

  /**
   * Door 6, the only grant writer. A human sets any target, and an open lifetime on your Revit
   * stamps the rw grant; any move retires it. Pea sets only null or Pea's own sessions.
   */
  function setHead(
    threadId: string,
    input: z.infer<typeof putTargetSchema>,
    caller: Extract<Caller, { kind: "human" | "pea" }>,
    door: string,
  ): PutTargetResult {
    const target = input.defaultTarget;
    const session =
      target === null ? null : target.kind === "open" ? target.ref.session : target.session;
    const acquired =
      target === null
        ? null
        : target.kind === "open"
          ? documentAcquisition(target.ref)
          : sessionAcquisition(target.session);
    if (caller.kind === "pea" && target !== null && acquired === null)
      throw new Refused({
        code: "grant.required",
        door,
        reason: `Refused at ${door}: Pea may point its thread only at documents it acquired; this one in session '${session}' is yours. Point this thread at it in the composer to grant rw, or open a copy.`,
      });
    const current = readHead(threadId);
    if (current.revision !== input.expectedRevision)
      return { ok: false, why: "stale", head: reading(current) };
    const now = Date.now();
    const head: ThreadHead = {
      defaultTarget: target,
      revision: current.revision + 1,
      ...(input.displayLabel ? { displayLabel: input.displayLabel } : {}),
      grant:
        caller.kind === "human" && target?.kind === "open" && acquired === null
          ? {
              lifetime: target.ref,
              grantedAt: new Date(now).toISOString(),
              grantedVia: caller.via,
              expiresAt: grantExpiry(now),
              revoked: null,
            }
          : null,
      lastHumanMessageAt: current.lastHumanMessageAt,
    };
    writeHead(threadId, head);
    return { ok: true, why: "set", head: reading(head) };
  }

  /** Door 7: one click revokes. Begun steps finish; the step-begin check refuses the rest. */
  function revokeHead(threadId: string): ThreadHeadReading {
    const current = readHead(threadId);
    if (!current.grant || current.grant.revoked) return reading(current);
    const grant = { ...current.grant, revoked: { at: new Date().toISOString() } };
    writeHead(threadId, { ...current, grant });
    emitRevoke(threadId, grant);
    return reading(readHead(threadId));
  }

  /** Door 8: a human message renews an unrevoked grant to 60 minutes from now. */
  function heardHuman(t: Thread) {
    const now = Date.now();
    const head = t.meta.head;
    writeHead(t.meta.id, {
      ...head,
      lastHumanMessageAt: new Date(now).toISOString(),
      grant:
        head.grant && !head.grant.revoked
          ? { ...head.grant, expiresAt: grantExpiry(now) }
          : head.grant,
    });
  }

  const heads = {
    read: readHead,
    /** Every thread's rw grant, for Machine's per-document access. */
    grants: () =>
      [...threads.values()].flatMap((t) =>
        t.meta.head.grant
          ? [{ thread: t.meta.id, title: t.meta.title, grant: t.meta.head.grant }]
          : [],
      ),
    /** Any head set, revoke or renewal. */
    subscribe(notify: () => void) {
      const listener = () => notify();
      headListeners.add(listener);
      return () => void headListeners.delete(listener);
    },
    /** The `thread-head` Reading: the current head, then every set. */
    observe(threadId: string, listener: (value: { value: ThreadHeadReading }) => void) {
      const notify = (id: string, head: ThreadHead) => {
        if (id === threadId) listener({ value: reading(head) });
      };
      headListeners.add(notify);
      const timer = setInterval(() => listener({ value: reading(readHead(threadId)) }), 15_000);
      headTimers.add(timer);
      queueMicrotask(() => {
        if (headListeners.has(notify)) listener({ value: reading(readHead(threadId)) });
      });
      return () => {
        clearInterval(timer);
        headTimers.delete(timer);
        headListeners.delete(notify);
      };
    },
  };

  function resolvePermission(
    t: Thread,
    requestId: string,
    optionId: string | null,
    by: "user" | "cancel" | "expired",
  ) {
    const pending = t.pending.get(requestId);
    if (!pending) return false;
    t.pending.delete(requestId);
    const turnId = pending.turnId;
    append(
      t,
      by === "user" && optionId
        ? { kind: "permission_resolved", turnId, requestId, by, optionId }
        : { kind: "permission_resolved", turnId, requestId, by: by === "user" ? "cancel" : by },
    );
    pending.resolve({
      outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
    });
    scheduleIdle(t);
    return true;
  }

  function resolveQuestion(
    t: Thread,
    requestId: string,
    answer: { action: "accept" | "decline"; content?: Record<string, unknown> } | null,
    by: "user" | "cancel" | "expired",
  ) {
    const pending = t.questions.get(requestId);
    if (!pending) return false;
    t.questions.delete(requestId);
    const turnId = pending.turnId;
    append(
      t,
      by === "user" && answer
        ? { kind: "question_resolved", turnId, requestId, by, ...answer }
        : { kind: "question_resolved", turnId, requestId, by: by === "user" ? "cancel" : by },
    );
    pending.resolve(
      (answer?.action === "accept"
        ? { action: "accept", content: answer.content ?? {} }
        : { action: answer ? "decline" : "cancel" }) as CreateElicitationResponse,
    );
    scheduleIdle(t);
    return true;
  }

  /** Every ask the turn left open ends with the turn. */
  function settleAsks(t: Thread, by: "cancel" | "expired") {
    for (const requestId of t.pending.keys()) resolvePermission(t, requestId, null, by);
    for (const requestId of t.questions.keys()) resolveQuestion(t, requestId, null, by);
  }

  async function connect(t: Thread): Promise<Live> {
    await options.prepare?.();
    const harness = t.meta.harness;
    const record = options.providers.get(t.meta.providerId);
    if (!record)
      throw new Error(
        `provider ${t.meta.providerId} was removed; fork this thread onto another provider`,
      );
    const env = await childEnv(record, options, t.meta.modelId);
    if (t.stopped) throw new Error("The thread was stopped before its harness connected");
    // One pea context per spawn: the child, its shell and its MCP server cross as this thread.
    const context = mintContext({ kind: "pea", thread: t.meta.id });
    env[HOST_CONTEXT_VARIABLE] = context;
    let live: Live | undefined;
    const { child, conn, stderr } = openAdapter(harness, options.worldRoot, env, () => ({
      sessionUpdate: ({ update }) => {
        if (t.child !== child || t.stopped) return;
        if (update.sessionUpdate === "config_option_update") {
          if (live) live.configOptions = update.configOptions;
          acceptConfiguration(t, update.configOptions);
        }
        // Persist before notifying readers; an SSE-triggered GET must see this configuration.
        append(t, { kind: "update", turnId: t.running, update });
        if (t.running) arm(t);
        if (update.sessionUpdate === "session_info_update" && update.title) {
          t.meta.title = update.title;
          writeMeta(t);
          append(t, { kind: "title_changed", title: update.title });
        }
        scheduleIdle(t);
      },
      requestPermission: (request: RequestPermissionRequest) =>
        new Promise<RequestPermissionResponse>((resolve) => {
          if (t.child !== child || t.stopped) return resolve({ outcome: { outcome: "cancelled" } });
          clearIdle(t);
          const requestId = randomUUID();
          const turnId = t.running;
          append(t, {
            kind: "permission_request",
            turnId,
            requestId,
            toolCall: { ...request.toolCall, title: request.toolCall.title ?? undefined },
            options: request.options.map(({ optionId, name, kind }) => ({
              optionId,
              name,
              kind,
            })),
          });
          t.pending.set(requestId, { turnId, resolve });
        }),
      // A form is the question card. A URL elicitation (MCP OAuth) has no place in Pea: declined.
      createElicitation: (request: CreateElicitationRequest) =>
        new Promise<CreateElicitationResponse>((resolve) => {
          if (t.child !== child || t.stopped) return resolve({ action: "decline" });
          clearIdle(t);
          if (request.mode !== "form") return resolve({ action: "decline" });
          const requestId = randomUUID();
          const turnId = t.running;
          append(t, {
            kind: "question_request",
            turnId,
            requestId,
            message: request.message,
            requestedSchema: request.requestedSchema as Record<string, unknown>,
          });
          t.questions.set(requestId, { turnId, resolve });
        }),
    }));
    t.child = child;
    child.once("exit", () => retireContext(context));
    child.on("exit", (code, signal) => {
      if (t.child !== child || t.session === "closed") return;
      clearIdle(t);
      t.child = null;
      t.session = "closed";
      t.live = null;
      settleAsks(t, "expired");
      append(t, {
        kind: "error",
        turnId: t.running,
        message: `${harness} harness exited (${signal ?? code}): ${stderr().trim().slice(-500)}`,
      });
    });
    const init = await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        elicitation: { form: {} },
      },
    });
    const request = { cwd: options.worldRoot, mcpServers: [options.mcpServer(context)] };
    // No session verb restores the user's model or traits (drive 2026-10-01: a sonnet thread came
    // back opus), so both are re-applied below.
    const wantModel = t.meta.modelId;
    const wantTraits = { ...t.meta.traitValues };
    const prior = t.meta.acpSessionId;
    const caps = init.agentCapabilities?.sessionCapabilities;
    const prompt = init.agentCapabilities?.promptCapabilities;
    t.meta.promptCapabilities = {
      image: Boolean(prompt?.image),
      embeddedContext: Boolean(prompt?.embeddedContext),
    };
    let state: Exclude<HarnessThreadBody["session"], "closed"> = "started";
    let session: NewSessionResponse | null = null;
    // `session/resume` picks the stored session up with no replay; the log already holds it.
    if (prior && caps?.resume)
      session = await conn.resumeSession({ ...request, sessionId: prior }).then(
        (resumed) => ((state = "resumed"), { ...resumed, sessionId: prior }),
        () => null,
      );
    const source = t.meta.forkOf?.acpSessionId;
    if (!session && !prior && source && caps?.fork)
      session = await conn.unstable_forkSession({ ...request, sessionId: source }).then(
        async (forked) => {
          // claude-agent-acp writes the fork to disk and answers only its id; `session/resume`
          // makes it live in this child. An adapter whose fork is already live refuses, harmlessly.
          const live = caps.resume
            ? await conn
                .resumeSession({ ...request, sessionId: forked.sessionId })
                .catch(() => null)
            : null;
          state = "forked";
          return { ...forked, ...live, sessionId: forked.sessionId };
        },
        () => null,
      );
    if (!session) {
      session = await conn.newSession(request);
      // A new session over a log with earlier turns never saw them: the next prompt carries them.
      // The turn being run now is not earlier; its prompt goes to the harness as itself.
      const earlier = t.events.filter((e) => e.kind !== "prompt" || e.turnId !== t.running);
      if (earlier.some((e) => e.kind === "prompt")) {
        state = "detached";
        t.refeed = transcript(earlier);
      }
    }
    const configOptions = session.configOptions ?? [];
    // `models` is the unstable ACP model state; the SDK type omits it.
    const offer = sessionOffer(session as Parameters<typeof sessionOffer>[0]);
    t.meta.models =
      record.auth.kind === "endpoint" ? options.providers.models(record.id) : offer.models;
    t.meta.traits = offer.traits;
    t.meta.modelId = offer.modelId;
    t.meta.acpSessionId = session.sessionId;
    writeMeta(t);
    t.session = state;
    append(t, { kind: "session", state, acpSessionId: session.sessionId });
    live = { conn, sessionId: session.sessionId, configOptions };
    const notReapplied = (what: string) => (error: unknown) =>
      void append(t, {
        kind: "error",
        turnId: t.running,
        message: `${what} was not re-applied (${state}); the harness default runs: ${String((error as Error)?.message ?? error)}`,
      });
    if (wantModel && wantModel !== t.meta.modelId)
      await setModel(t, live, wantModel).catch(notReapplied(`model ${wantModel}`));
    for (const [id, value] of Object.entries(wantTraits))
      if (t.meta.traits.find((trait) => trait.id === id)?.current !== value)
        await setTrait(t, live, id, value).catch(notReapplied(`${id} ${String(value)}`));
    // The access setting picks the mode every session starts in: no mode picker, no plan mode.
    const access = options.providers.access();
    const offered = new Set(session.modes?.availableModes.map((m) => m.id));
    const mode = accessModes[access.guarded ? "guarded" : "unguarded"].find((m) => offered.has(m));
    if (mode && mode !== session.modes?.currentModeId)
      await live.conn
        .setSessionMode({ sessionId: live.sessionId, modeId: mode })
        .catch(notReapplied(`access mode ${mode}`));
    return live;
  }

  async function ensure(t: Thread): Promise<Live> {
    if (options.updatePending?.())
      throw Error("Pe.Tools is updating; try this after the update finishes.");
    if (t.retiring) await t.retiring;
    if (options.updatePending?.())
      throw Error("Pe.Tools is updating; try this after the update finishes.");
    if (t.stopped) throw new Error("The thread was stopped");
    if (!t.live) {
      t.session = "started";
      t.busy++;
      const connecting = connect(t);
      t.live = connecting;
      void connecting.then(
        () => {
          t.busy--;
          scheduleIdle(t);
        },
        (error) => {
          t.busy--;
          if (t.live !== connecting || t.stopped) return;
          t.live = null;
          t.session = "closed";
          options.providers.invalidate(
            t.meta.providerId,
            "The harness failed to start; probe again.",
          );
          append(t, {
            kind: "error",
            turnId: t.running,
            message: `${t.meta.harness} harness failed to start: ${String(error?.message ?? error)}`,
          });
        },
      );
    }
    return t.live;
  }

  function clearIdle(t: Thread) {
    if (t.idle) clearTimeout(t.idle);
    t.idle = null;
  }

  const canIdle = (t: Thread) =>
    t.child &&
    t.live &&
    !t.stopped &&
    !t.busy &&
    !t.running &&
    !t.retiring &&
    !t.pending.size &&
    !t.questions.size;

  /** Detach the child, then stop it: a new use waits for retirement, old callbacks own no thread. */
  function retire(t: Thread) {
    clearIdle(t);
    const child = t.child;
    t.child = null;
    t.live = null;
    t.session = "closed";
    t.retiring = stopChild(child)
      .catch((error) => warn(`harness ${t.meta.id} did not stop: ${String(error)}`))
      .finally(() => {
        t.retiring = null;
      });
    return t.retiring;
  }

  /** Delete and host shutdown: no turn, timer or child outlives the thread. */
  async function stop(t: Thread) {
    t.session = "closed";
    t.stopped = true;
    disarm(t);
    clearIdle(t);
    await t.retiring;
    await stopChild(t.child);
  }

  function scheduleIdle(t: Thread) {
    clearIdle(t);
    if (!canIdle(t)) return;
    t.idle = setTimeout(() => {
      t.idle = null;
      if (canIdle(t)) void retire(t);
    }, IDLE_CHILD_MS);
    t.idle.unref();
  }

  async function useLive<T>(t: Thread, work: (live: Live) => Promise<T>): Promise<T> {
    clearIdle(t);
    t.busy++;
    try {
      return await work(await ensure(t));
    } finally {
      t.busy--;
      scheduleIdle(t);
    }
  }

  async function setModel(t: Thread, live: Live, modelId: string) {
    const option = live.configOptions.find((o) => o.category === "model");
    // An adapter with no model config option takes the unstable `session/set_model`.
    const setUnstable = async () => {
      await live.conn.extMethod("session/set_model", { sessionId: live.sessionId, modelId });
      t.meta.modelId = modelId;
    };
    if (option)
      await configure(t, live, { configId: option.id, value: modelId }).catch(
        (error: { code?: number }) => {
          if (error?.code !== -32601) throw error; // JSON-RPC method not found
          return setUnstable();
        },
      );
    else if (t.meta.models.length > 0) await setUnstable();
    else throw new Error(`${t.meta.harness} offers no model choice`);
    if (!t.meta.modelId) throw new Error("The harness did not report its selected model");
    writeMeta(t);
    append(t, { kind: "model_changed", modelId: t.meta.modelId });
  }

  function acceptConfiguration(t: Thread, configOptions: SessionConfigOption[]) {
    const offer = sessionOffer({ configOptions });
    if (configOptions.some((option) => option.category === "model")) {
      t.meta.modelId = offer.modelId;
      if (options.providers.get(t.meta.providerId)?.auth.kind === "subscription")
        t.meta.models = offer.models;
    }
    t.meta.traits = offer.traits;
    t.meta.traitValues = Object.fromEntries(
      offer.traits.flatMap((trait) => (trait.current === null ? [] : [[trait.id, trait.current]])),
    );
    writeMeta(t);
  }

  /** ACP `session/set_config_option`; the answer restates every option, so traits follow it. */
  async function configure(
    t: Thread,
    live: Live,
    change: { configId: string; value: string | boolean },
  ) {
    const request = {
      sessionId: live.sessionId,
      ...change,
      ...(typeof change.value === "boolean" ? { type: "boolean" } : {}),
    } as SetSessionConfigOptionRequest;
    const answer = await live.conn.setSessionConfigOption(request);
    if (!answer?.configOptions)
      throw new Error("The harness did not acknowledge its configuration");
    live.configOptions = answer.configOptions;
    acceptConfiguration(t, answer.configOptions);
  }

  async function setTrait(t: Thread, live: Live, id: string, value: string | boolean) {
    const trait = t.meta.traits.find((o) => o.id === id);
    if (!trait) throw new Error(`${t.meta.providerName} offers no trait ${id}`);
    if (typeof value !== (trait.kind === "boolean" ? "boolean" : "string"))
      throw new Error(`trait ${id} takes a ${trait.kind === "boolean" ? "boolean" : "string"}`);
    await configure(t, live, { configId: id, value });
    const accepted = t.meta.traits.find((option) => option.id === id)?.current;
    if (accepted === undefined || accepted === null)
      throw new Error(`The harness did not report a value for trait ${id}`);
    append(t, { kind: "trait_changed", traitId: id, value: accepted });
  }

  /**
   * The turn marker: a running turn that hears nothing from the harness for {@link WAITING_MS} logs
   * `waiting`, then again each period, from the host's own clock. An open ask is the user's wait,
   * not the model's: it skips the marker.
   */
  function arm(t: Thread) {
    t.lastUpdateAt = Date.now();
    if (t.waiting) clearTimeout(t.waiting);
    const fire = () => {
      const turnId = t.running;
      if (!turnId || t.stopped) return void (t.waiting = null);
      if (t.pending.size === 0 && t.questions.size === 0)
        append(t, { kind: "waiting", turnId, sinceMs: Date.now() - t.lastUpdateAt });
      t.waiting = setTimeout(fire, WAITING_MS);
    };
    t.waiting = setTimeout(fire, WAITING_MS);
  }
  function disarm(t: Thread) {
    if (t.waiting) clearTimeout(t.waiting);
    t.waiting = null;
  }

  async function run(
    t: Thread,
    turnId: string,
    text: string,
    attachments?: PromptAttachment[],
    mentions?: Mention[],
  ) {
    clearIdle(t);
    t.running = turnId;
    append(t, {
      kind: "prompt",
      turnId,
      text,
      ...(attachments ? { attachments } : {}),
      ...(mentions ? { mentions } : {}),
    });
    arm(t);
    try {
      if (!t.live) append(t, { kind: "starting", turnId });
      const live = await ensure(t);
      const refeed = t.refeed;
      t.refeed = null;
      const result = await live.conn.prompt({
        sessionId: live.sessionId,
        prompt: promptBlocks(
          join(options.root, t.meta.id, "attachments", turnId),
          refeed ? `${refeed}\n\n${text}` : text,
          attachments,
          mentions,
          // `ensure` read the harness's prompt capabilities at its `initialize`.
          t.meta.promptCapabilities?.embeddedContext,
        ),
      });
      append(t, { kind: "turn_end", turnId, stopReason: result.stopReason });
    } catch (error) {
      // A stopped thread's open turn is ended by restart recovery, not by "connection closed".
      if (!t.stopped) {
        options.providers.invalidate(t.meta.providerId, "The harness turn failed; probe again.");
        const raw = String((error as Error)?.message ?? error);
        const failure =
          options.providers.get(t.meta.providerId)?.auth.kind === "endpoint"
            ? classifyEndpointFailure(error)
            : undefined;
        append(t, {
          kind: "error",
          turnId,
          message: failure?.message ?? raw,
          ...(failure ? { failure } : {}),
        });
      }
    }
    disarm(t);
    t.running = null;
    scheduleIdle(t);
  }

  /**
   * ACP `session/cancel` on the running turn; its open asks settle as cancelled. The log names who
   * asked and at which door first: a bare `cancelled` turn_end is otherwise unattributable.
   */
  async function cancel(t: Thread, by: Caller, door: string) {
    const turnId = t.running;
    settleAsks(t, "cancel");
    const live = turnId ? await t.live?.catch(() => null) : null;
    if (turnId && live) append(t, { kind: "cancel_requested", turnId, by, door });
    if (live) await live.conn.cancel({ sessionId: live.sessionId });
    return Boolean(live);
  }

  /** Cancel the running turn and wait for its end; false when it outlives {@link INTERRUPT_MS}. */
  async function interrupt(t: Thread, by: Caller, door: string) {
    const turn = t.turn;
    await cancel(t, by, door);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ended = await Promise.race([
      turn.then(() => true),
      new Promise<boolean>((resolve) => (timer = setTimeout(resolve, INTERRUPT_MS, false))),
    ]);
    clearTimeout(timer);
    return ended;
  }

  function stream(t: Thread, after: number, signal: AbortSignal): Response {
    let cleanup = () => {};
    const encoder = new TextEncoder();
    const frame = (event: HarnessEvent) =>
      encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          // A client gone without `cancel` makes enqueue throw; that ends this stream, nothing else.
          const send = (bytes: Uint8Array) => {
            try {
              controller.enqueue(bytes);
            } catch {
              cleanup();
            }
          };
          const listener = (event: HarnessEvent) => send(frame(event));
          const close = () => {
            cleanup();
            try {
              controller.close();
            } catch {
              // already closed or errored
            }
          };
          cleanup = () => {
            clearInterval(heartbeat);
            t.listeners.delete(listener);
            signal.removeEventListener("abort", close);
          };
          send(encoder.encode(": open\n\n"));
          for (const event of t.events.slice(after)) send(frame(event));
          heartbeat = setInterval(() => send(encoder.encode(": heartbeat\n\n")), 15_000);
          t.listeners.add(listener);
          if (signal.aborted) close();
          else signal.addEventListener("abort", close, { once: true });
        },
        cancel: () => cleanup(),
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  }

  const json = (value: unknown, status = 200) => Response.json(value, { status });

  async function handle(request: Request): Promise<Response> {
    const caller = currentCaller();
    const url = new URL(request.url);
    const declared = matchPeRoute(request.method, url.pathname);
    if (!declared || declared.route.owner !== "threads")
      return json({ error: "Unknown thread route" }, 404);
    const id = declared.params.id;
    const method = request.method;
    if (declared.id === "threads.stream") {
      const encoder = new TextEncoder();
      let cleanup = () => {};
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            let scheduled: ReturnType<typeof setTimeout> | undefined;
            const send = () => {
              scheduled = undefined;
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify([...threads.values()].map(summary))}\n\n`),
                );
              } catch {
                cleanup();
              }
            };
            // Coalesce token bursts; this is one projection stream, never one child stream per row.
            const dirty = () => {
              scheduled ??= setTimeout(send, 100);
            };
            const close = () => {
              cleanup();
              try {
                controller.close();
              } catch {}
            };
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
              } catch {
                cleanup();
              }
            }, 15_000);
            cleanup = () => {
              clearTimeout(scheduled);
              clearInterval(heartbeat);
              summaryListeners.delete(dirty);
              request.signal.removeEventListener("abort", close);
            };
            summaryListeners.add(dirty);
            send();
            if (request.signal.aborted) close();
            else request.signal.addEventListener("abort", close, { once: true });
          },
          cancel() {
            cleanup();
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        },
      );
    }
    // Only routes that read a body require JSON; cancel and delete take none.
    const input = async <T>(schema: z.ZodType<T>) => {
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new NotJson();
      return schema.parse(await request.json());
    };
    if (declared.id.startsWith("scope.")) {
      const named = declared.params.id;
      // `self` is the caller's own thread: a pea context's, bound at spawn. No thread string travels.
      const self = named === "self";
      const threadId = self ? (caller.kind === "pea" ? caller.thread : null) : (named ?? "");
      const door = url.pathname;
      if (!threadId)
        return json(
          {
            error:
              threadId === null
                ? `${door} answers only a Pea harness context`
                : `No route ${method} ${url.pathname}`,
          },
          404,
        );
      if (declared.id === "scope.get")
        return json({ ...(self ? { thread: threadId } : {}), ...reading(readHead(threadId)) });
      if (declared.id === "scope.revoke") {
        requireHuman(caller, door, "revoking rw");
        return json({
          ...revokeHead(threadId),
          receipt:
            "rw revoked. Steps already running finish; nothing new starts. Re-point the head to grant again.",
        });
      }
      if (declared.id !== "scope.set")
        return json({ error: `No route ${method} ${url.pathname}` }, 404);
      if (caller.kind === "pea" && caller.thread !== threadId)
        throw new Refused({
          code: "context.foreign-thread",
          door,
          reason: `This context belongs to thread ${caller.thread}; it cannot write thread ${threadId}'s head.`,
        });
      if (caller.kind !== "pea") requireHuman(caller, door, "setting a thread head");
      const result = setHead(
        threadId,
        await input(putTargetSchema),
        caller as Extract<Caller, { kind: "human" | "pea" }>,
        door,
      );
      return json(result, result.ok ? 200 : 409);
    }
    if (declared.id === "threads.list")
      return json(
        [...threads.values()].map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    if (declared.id === "threads.create") {
      const { providerId, title } = await input(createThreadRequestSchema);
      if (options.updatePending?.())
        return json(
          { error: "Pe.Tools is updating; create this thread after the update finishes." },
          409,
        );
      const record = options.providers.get(providerId);
      if (!record) return json({ error: `No provider ${providerId}` }, 400);
      const now = new Date().toISOString();
      const t = create({
        id: randomUUID(),
        harness: record.harness,
        providerId: record.id,
        providerName: record.name,
        title: title ?? "New thread",
        createdAt: now,
        updatedAt: now,
        modelId: null,
        acpSessionId: null,
        models: [],
        traits: [],
        traitValues: {},
        head: emptyThreadHead,
        forkOf: null,
        promptCapabilities: null,
        lifecycle: emptyThreadLifecycle(),
      });
      return json(summary(t));
    }
    const t = id ? threads.get(id) : undefined;
    if (!t) return json({ error: `No thread ${id}` }, 404);
    const key = declared.id;
    switch (key) {
      case "thread.get":
        return json(body(t));
      case "thread.export":
        try {
          return exportThread(options.root, t.meta.id);
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Thread export failed" },
            422,
          );
        }
      case "thread.update": {
        const change = await input(updateThreadRequestSchema);
        const state = activity(t);
        const lifecycleChange = Object.keys(change).some(
          (key) => !["expectedRevision", "title", "readSeq"].includes(key),
        );
        if (
          (lifecycleChange || change.readSeq !== undefined) &&
          change.expectedRevision !== t.meta.lifecycle.revision
        )
          return json(
            {
              error: "Thread lifecycle changed in another window; review it and try again",
              thread: summary(t),
            },
            409,
          );
        if (
          (change.status === "archived" || change.status === "settled") &&
          (state.state === "running" || state.pending)
        )
          return json(
            { error: "Finish or stop the running turn and answer its asks before archiving" },
            409,
          );
        if (change.snoozedUntil && state.pending)
          return json({ error: "Answer pending asks before snoozing" }, 409);
        if (change.readSeq !== undefined && change.readSeq > t.events.length)
          return json({ error: "Cannot mark unseen events as read" }, 400);
        if (change.snoozedUntil && Date.parse(change.snoozedUntil) <= Date.now())
          return json({ error: "Choose a future snooze time" }, 400);
        const { title, expectedRevision: _expected, ...lifecycle } = change;
        if (title !== undefined) t.meta.title = title;
        const previousRead = t.meta.lifecycle.readSeq;
        const wasExplicitUnread = t.meta.lifecycle.explicitUnread;
        const wasSnoozed = t.meta.lifecycle.snoozedUntil !== null;
        Object.assign(t.meta.lifecycle, lifecycle);
        if (change.readSeq !== undefined)
          t.meta.lifecycle.readSeq = Math.max(previousRead, change.readSeq);
        if (change.readSeq !== undefined && change.explicitUnread === undefined)
          t.meta.lifecycle.explicitUnread = false;
        if (change.snoozedUntil) {
          t.meta.lifecycle.snoozedSeq = state.lastSeq;
          t.meta.lifecycle.status = "active";
        }
        if (change.snoozedUntil === null && wasSnoozed)
          t.meta.lifecycle.reopenedAt = new Date().toISOString();
        if (change.status === "settled") {
          t.meta.lifecycle.pinned = false;
          t.meta.lifecycle.snoozedUntil = null;
          t.meta.lifecycle.order = null;
          t.meta.lifecycle.settledAt = new Date().toISOString();
        }
        if (change.pinned === true || change.status === "active") {
          t.meta.lifecycle.status = "active";
          t.meta.lifecycle.settledAt = null;
          t.meta.lifecycle.snoozedUntil = null;
          t.meta.lifecycle.reopenedAt = new Date().toISOString();
        }
        if (
          lifecycleChange ||
          (wasExplicitUnread && change.readSeq !== undefined && change.explicitUnread === undefined)
        )
          t.meta.lifecycle.revision++;
        writeMeta(t);
        if (title !== undefined) append(t, { kind: "title_changed", title: t.meta.title });
        notifySummaries();
        return json(summary(t));
      }
      case "thread.remove":
        threads.delete(t.meta.id);
        await stop(t);
        rmSync(join(options.root, t.meta.id), { recursive: true, force: true });
        notifySummaries();
        return new Response(null, { status: 204 });
      case "thread.prompt": {
        // Only a human message moves a thread, and only it renews the grant: Pea cannot renew itself.
        requireHuman(caller, url.pathname, "a thread message");
        const { text, attachments: sent, mentions: named } = await input(promptRequestSchema);
        const attachments = sent?.length ? sent : undefined;
        const mentions = named?.length ? named : undefined;
        if (options.updatePending?.())
          return json({ error: "Pe.Tools is updating; send this after the update finishes." }, 409);
        if (t.meta.lifecycle.status === "archived")
          return json({ error: "Restore this archived thread before sending" }, 409);
        if (attachments) {
          // The harness says what it reads at `initialize`; learn it before admitting the turn.
          if (!t.meta.promptCapabilities) await ensure(t).catch(() => null);
          const refusal = attachmentRefusal(
            attachments,
            t.meta.promptCapabilities,
            t.meta.providerName,
          );
          if (refusal) return json({ error: refusal }, 400);
        }
        // A prompt on a running turn interrupts it: that turn ends cancelled, then this one starts.
        while (t.running)
          if (!(await interrupt(t, caller, url.pathname)))
            return json(
              {
                error: `${t.meta.providerName} did not stop the running turn within ${INTERRUPT_MS / 1000} s; press Stop, then send again`,
              },
              409,
            );
        if (t.stopped) return json({ error: `No thread ${id}` }, 404);
        if (t.meta.lifecycle.status === "settled" || t.meta.lifecycle.snoozedUntil)
          t.meta.lifecycle.reopenedAt = new Date().toISOString();
        t.meta.lifecycle.status = "active";
        t.meta.lifecycle.settledAt = null;
        t.meta.lifecycle.snoozedUntil = null;
        t.meta.lifecycle.revision++;
        heardHuman(t);
        const turnId = randomUUID();
        t.turn = run(t, turnId, text, attachments, mentions);
        return json({ turnId });
      }
      case "thread.cancel":
        return json({ cancelled: await cancel(t, caller, url.pathname) });
      case "thread.permission": {
        const { requestId, optionId } = await input(permissionResponseSchema);
        return resolvePermission(t, requestId, optionId, "user")
          ? json({ ok: true })
          : json({ error: `No pending permission ${requestId}` }, 409);
      }
      case "thread.question": {
        const { requestId, ...answer } = await input(questionResponseSchema);
        return resolveQuestion(t, requestId, answer, "user")
          ? json({ ok: true })
          : json({ error: `No pending question ${requestId}` }, 409);
      }
      // The log is copied whole. Same provider: ACP `session/fork` carries the model context.
      // Another: a new session, and the first prompt carries the transcript (`detached`).
      case "thread.fork": {
        if (t.running) return json({ error: "Fork after the running turn ends" }, 409);
        const { providerId = t.meta.providerId, title } = await input(forkThreadRequestSchema);
        const record = options.providers.get(providerId);
        if (!record) return json({ error: `No provider ${providerId}` }, 400);
        const same = record.id === t.meta.providerId;
        const now = new Date().toISOString();
        const forked = create(
          {
            ...t.meta,
            id: randomUUID(),
            harness: record.harness,
            providerId: record.id,
            providerName: record.name,
            title: title ?? `${t.meta.title} (fork)`,
            createdAt: now,
            updatedAt: now,
            acpSessionId: null,
            modelId: same ? t.meta.modelId : null,
            models: [],
            traits: [],
            traitValues: same ? { ...t.meta.traitValues } : {},
            forkOf: { threadId: t.meta.id, acpSessionId: same ? t.meta.acpSessionId : null },
            lifecycle: emptyThreadLifecycle(),
          },
          [...t.events],
        );
        return json(summary(forked));
      }
      case "thread.model": {
        const { modelId } = await input(z.object({ modelId: z.string() }));
        const record = options.providers.get(t.meta.providerId);
        if (record?.auth.kind === "endpoint") {
          if (t.running)
            return json({ error: "Change the model after the running action ends" }, 409);
          // Creating a thread starts its connection in the background. Model selection
          // from the first send waits for that startup rather than refusing its busy marker.
          await ensure(t);
          if (t.running || t.busy)
            return json({ error: "Change the model after the running action ends" }, 409);
          t.busy++;
          try {
            if (!t.meta.models.some((model) => model.modelId === modelId))
              return json({ error: `The endpoint does not advertise model ${modelId}` }, 400);
            try {
              await options.providers.validateModel(record, modelId);
            } catch (error) {
              const failure = classifyEndpointFailure(error);
              return json({ message: failure.message, failure }, 400);
            }
            // Both adapters admit custom IDs at startup; their ACP pickers can reject those IDs.
            // Resume the same durable session in a child pinned to the requested endpoint model.
            t.meta.modelId = modelId;
            writeMeta(t);
            await retire(t);
            await ensure(t);
            if (t.meta.modelId !== modelId)
              throw new Error(`The harness did not select endpoint model ${modelId}`);
            append(t, { kind: "model_changed", modelId });
            return json(summary(t));
          } finally {
            t.busy--;
            scheduleIdle(t);
          }
        }
        await useLive(t, (live) => setModel(t, live, modelId));
        return json(summary(t));
      }
      case "thread.trait": {
        const { id: traitId, value } = await input(traitRequestSchema);
        await useLive(t, (live) => setTrait(t, live, traitId, value));
        return json(body(t));
      }
      case "thread.stream": {
        const after = Number(
          url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0,
        );
        return stream(t, Number.isFinite(after) ? after : 0, request.signal);
      }
    }
    return json({ error: `No route ${method} ${url.pathname}` }, 404);
  }

  // Restart recovery: a turn open in the log ended with the host that ran it. Its open asks expire
  // and the turn ends in an error.
  for (const t of threads.values()) {
    const resolved = new Set(
      t.events.flatMap((e) =>
        e.kind === "permission_resolved" || e.kind === "question_resolved" ? [e.requestId] : [],
      ),
    );
    for (const e of t.events)
      if (
        (e.kind === "permission_request" || e.kind === "question_request") &&
        !resolved.has(e.requestId)
      )
        append(t, {
          kind: e.kind === "permission_request" ? "permission_resolved" : "question_resolved",
          turnId: e.turnId,
          requestId: e.requestId,
          by: "expired",
        });
    const ended = new Set(
      t.events.flatMap((e) => (e.kind === "turn_end" || e.kind === "error" ? [e.turnId] : [])),
    );
    const last = t.events.findLast((e) => e.kind === "prompt");
    if (last?.kind === "prompt" && !ended.has(last.turnId))
      append(t, { kind: "error", turnId: last.turnId, message: "host restarted during this turn" });
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const t of threads.values()) {
      const lifecycle = t.meta.lifecycle;
      const state = activity(t);
      if (lifecycle.snoozedUntil && Date.parse(lifecycle.snoozedUntil) <= now) {
        lifecycle.snoozedUntil = null;
        lifecycle.reopenedAt = new Date().toISOString();
        lifecycle.revision++;
        writeMeta(t);
        changed = true;
      }
      const threshold =
        lifecycle.autoSettle === "1d"
          ? 86_400_000
          : lifecycle.autoSettle === "7d"
            ? 604_800_000
            : null;
      const at = Math.max(
        Date.parse(t.events.findLast(isActivity)?.at ?? t.meta.createdAt),
        Date.parse(lifecycle.reopenedAt ?? t.meta.createdAt),
      );
      if (
        threshold &&
        lifecycle.status === "active" &&
        !lifecycle.pinned &&
        !lifecycle.snoozedUntil &&
        state.state !== "running" &&
        !state.pending &&
        now - at >= threshold
      ) {
        lifecycle.status = "settled";
        lifecycle.settledAt = new Date().toISOString();
        lifecycle.order = null;
        lifecycle.revision++;
        writeMeta(t);
        changed = true;
      }
    }
    if (changed) notifySummaries();
  }, 60_000);
  sweep.unref();

  return {
    receiptSnapshot: () =>
      [...threads.values()].map((t) => ({ id: t.meta.id, title: t.meta.title, events: t.events })),
    /** Automatic updates wait for every turn and harness action to finish. */
    active: () => [...threads.values()].some((t) => t.running !== null || t.busy > 0),
    /** The thread head store; the `thread-head` Reading observes it. */
    heads,
    /** The web handler for `/pe/threads*` and `/pe/scope/:id`. Bad input is 400; a harness refusal 502. */
    fetch: (request: Request) =>
      handle(request).catch((error) =>
        error instanceof Refused
          ? json({ error: error.message, refusal: error.refusal }, 403)
          : error instanceof NotJson
            ? json(
                { error: "This route reads a JSON body: send content-type: application/json" },
                415,
              )
            : json(
                { error: String(error?.message ?? error) },
                error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 502,
              ),
      ),
    /** Host shutdown: stop every harness child and its tree. */
    close: () => {
      clearInterval(sweep);
      for (const timer of headTimers) clearInterval(timer);
      headTimers.clear();
      return Promise.all([...threads.values()].map(stop));
    },
  };
}
