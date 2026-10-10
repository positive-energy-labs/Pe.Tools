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
import { join } from "node:path";
import {
  type ClientSideConnection,
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
  createThreadRequestSchema,
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
  type PutTargetResult,
  type ThreadHead,
} from "@pe/agent-contracts";
import { Effect } from "effect";
import { z } from "zod";
import { openAdapter, stopChild } from "./adapter.ts";
import { accessModes, sessionOffer, traitsOf, type Providers } from "./providers.ts";

/** The thread wire of ADR 0015; contract and route list in `@pe/agent-contracts` `harness-thread.ts`. */

type Meta = Omit<HarnessThreadSummary, "lastSeq"> & {
  acpSessionId: string | null;
  models: HarnessThreadBody["models"];
  traits: HarnessThreadBody["traits"];
  /** Trait values the user chose, re-applied when a session comes back with the harness default. */
  traitValues: Record<string, string | boolean>;
  /** The thread head the Pea MCP child reads through `GET /pe/scope/:id`. */
  head: ThreadHead;
  /** Prompts accepted while a turn ran; a restarted host runs them after resume. */
  queued: HarnessThreadBody["queued"];
  /** The thread this one was forked from; `acpSessionId` is null when the fork crossed providers. */
  forkOf: { threadId: string; acpSessionId: string | null } | null;
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
  /** Set by delete or host shutdown: the turn in flight stops logging and nothing queued starts. */
  stopped: boolean;
  running: string | null;
  pending: Map<string, Pending<RequestPermissionResponse>>;
  questions: Map<string, Pending<CreateElicitationResponse>>;
  listeners: Set<(event: HarnessEvent) => void>;
  /** The turn marker's clock: re-armed by every session update, cleared at turn end. */
  waiting: ReturnType<typeof setTimeout> | null;
  lastUpdateAt: number;
  idle: ReturnType<typeof setTimeout> | null;
  busy: number;
  retiring: Promise<void> | null;
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
  /** The Pea MCP server the child launches, bound to `threadId` through `PE_THREAD`. */
  mcpServer: (threadId: string) => {
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
};

const emptyHead: ThreadHead = { defaultTarget: null, revision: 0 };
/** A turn with no session update for this long gets a `waiting` marker, and again each period. */
export const WAITING_MS = 60_000;
export const IDLE_CHILD_MS = 15 * 60_000;
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
 * The child's env on top of the host's: the provider's (the user's shell PATH and its auth source),
 * and for Codex its developer instructions. The user's own Codex MCP servers are kept out by the
 * project-level config the routes write in the world root, never here: codex-acp replaces a
 * CODEX_CONFIG `mcp_servers`.
 */
async function childEnv(
  record: NonNullable<ReturnType<Providers["get"]>>,
  options: HarnessThreadsOptions,
  modelId?: string | null,
): Promise<Record<string, string>> {
  const env = await options.providers.env(record, modelId);
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
      lines.push(`User: ${e.text}`);
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

/** tmp + rename, so a crash mid-write never leaves a torn file. */
function writeJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

export function createHarnessThreads(options: HarnessThreadsOptions) {
  const threads = new Map<string, Thread>();
  const headListeners = new Set<(threadId: string, head: ThreadHead) => void>();
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
      meta.head ??= emptyHead;
      meta.queued ??= [];
      meta.forkOf ??= null;
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
    return {
      meta,
      child: null,
      events,
      live: null,
      refeed: null,
      session: "closed",
      stopped: false,
      running: null,
      pending: new Map(),
      questions: new Map(),
      listeners: new Set(),
      waiting: null,
      lastUpdateAt: 0,
      idle: null,
      busy: 0,
      retiring: null,
    };
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
    appendFileSync(join(options.root, t.meta.id, "events.jsonl"), `${redacted}\n`);
    for (const listener of t.listeners) listener(full);
    return full;
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
  });

  const body = (t: Thread): HarnessThreadBody => ({
    ...summary(t),
    models: t.meta.models,
    traits: t.meta.traits,
    running: t.running !== null,
    queued: t.meta.queued,
    session: t.session,
    events: t.events,
  });

  /* ── The thread head: `meta.head` on a harness thread, else `.heads/<sha256>.json` ── */

  const headFile = (threadId: string) =>
    join(headsDir, `${createHash("sha256").update(threadId).digest("hex")}.json`);

  function readHead(threadId: string): ThreadHead {
    const t = threads.get(threadId);
    if (t) return t.meta.head;
    const file = headFile(threadId);
    if (!existsSync(file)) return emptyHead;
    const parsed = threadHeadSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) warn(`thread head ${threadId}: stored head no longer parses`);
    return parsed.data ?? emptyHead;
  }

  /** Every write says what it read. No in-turn refusal: the child reads the live head per call. */
  function setHead(threadId: string, input: z.infer<typeof putTargetSchema>): PutTargetResult {
    const current = readHead(threadId);
    if (current.revision !== input.expectedRevision)
      return { ok: false, why: "stale", head: current };
    const head = { defaultTarget: input.defaultTarget, revision: current.revision + 1 };
    const t = threads.get(threadId);
    if (t) {
      t.meta.head = head;
      writeMeta(t);
    } else writeJson(headFile(threadId), head);
    for (const listener of headListeners) listener(threadId, head);
    return { ok: true, why: "set", head };
  }

  const heads = {
    read: readHead,
    /** The `thread-head` Reading: the current head, then every set. */
    observe(threadId: string, listener: (value: { value: ThreadHead }) => void) {
      const notify = (id: string, head: ThreadHead) => {
        if (id === threadId) listener({ value: head });
      };
      headListeners.add(notify);
      queueMicrotask(() => {
        if (headListeners.has(notify)) listener({ value: readHead(threadId) });
      });
      return () => void headListeners.delete(notify);
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
    const harness = t.meta.harness;
    const record = options.providers.get(t.meta.providerId);
    if (!record)
      throw new Error(
        `provider ${t.meta.providerId} was removed; fork this thread onto another provider`,
      );
    const env = await childEnv(record, options, t.meta.modelId);
    if (t.stopped) throw new Error("The thread was stopped before its harness connected");
    // The host env unchanged (a user's own ANTHROPIC_API_KEY stays), plus the child's own.
    const { child, conn, stderr } = openAdapter(
      harness,
      options.worldRoot,
      { ...process.env, ...env },
      () => ({
        sessionUpdate: ({ update }) => {
          if (t.child !== child || t.stopped) return;
          append(t, { kind: "update", turnId: t.running, update });
          if (t.running) arm(t);
          if (update.sessionUpdate === "config_option_update") {
            t.meta.traits = traitsOf(update.configOptions);
            writeMeta(t);
          }
          if (update.sessionUpdate === "session_info_update" && update.title) {
            t.meta.title = update.title;
            writeMeta(t);
            append(t, { kind: "title_changed", title: update.title });
          }
          scheduleIdle(t);
        },
        requestPermission: (request: RequestPermissionRequest) =>
          new Promise<RequestPermissionResponse>((resolve) => {
            if (t.child !== child || t.stopped)
              return resolve({ outcome: { outcome: "cancelled" } });
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
      }),
    );
    t.child = child;
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
    const request = { cwd: options.worldRoot, mcpServers: [options.mcpServer(t.meta.id)] };
    // No session verb restores the user's model or traits (drive 2026-10-01: a sonnet thread came
    // back opus), so both are re-applied below.
    const wantModel = t.meta.modelId;
    const prior = t.meta.acpSessionId;
    const caps = init.agentCapabilities?.sessionCapabilities;
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
    const live = { conn, sessionId: session.sessionId, configOptions };
    const notReapplied = (what: string) => (error: unknown) =>
      void append(t, {
        kind: "error",
        turnId: t.running,
        message: `${what} was not re-applied (${state}); the harness default runs: ${String((error as Error)?.message ?? error)}`,
      });
    if (wantModel && wantModel !== t.meta.modelId)
      await setModel(t, live, wantModel).catch(notReapplied(`model ${wantModel}`));
    for (const [id, value] of Object.entries(t.meta.traitValues))
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
    !t.meta.queued.length &&
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
    const setUnstable = () =>
      live.conn.extMethod("session/set_model", { sessionId: live.sessionId, modelId });
    if (option)
      await configure(t, live, { configId: option.id, value: modelId }).catch(
        (error: { code?: number }) => {
          if (error?.code !== -32601) throw error; // JSON-RPC method not found
          return setUnstable();
        },
      );
    else if (t.meta.models.length > 0) await setUnstable();
    else throw new Error(`${t.meta.harness} offers no model choice`);
    t.meta.modelId = modelId;
    writeMeta(t);
    append(t, { kind: "model_changed", modelId });
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
    if (answer?.configOptions) {
      live.configOptions = answer.configOptions;
      t.meta.traits = traitsOf(answer.configOptions);
    }
  }

  async function setTrait(t: Thread, live: Live, id: string, value: string | boolean) {
    const trait = t.meta.traits.find((o) => o.id === id);
    if (!trait) throw new Error(`${t.meta.providerName} offers no trait ${id}`);
    if (typeof value !== (trait.kind === "boolean" ? "boolean" : "string"))
      throw new Error(`trait ${id} takes a ${trait.kind === "boolean" ? "boolean" : "string"}`);
    await configure(t, live, { configId: id, value });
    t.meta.traits = t.meta.traits.map((o) =>
      o.id !== id
        ? o
        : o.kind === "boolean"
          ? { ...o, current: value as boolean }
          : { ...o, current: value as string },
    );
    t.meta.traitValues[id] = value;
    writeMeta(t);
    append(t, { kind: "trait_changed", traitId: id, value });
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

  async function run(t: Thread, turnId: string, text: string) {
    clearIdle(t);
    t.running = turnId;
    append(t, { kind: "prompt", turnId, text });
    arm(t);
    try {
      const live = await ensure(t);
      const refeed = t.refeed;
      t.refeed = null;
      const result = await live.conn.prompt({
        sessionId: live.sessionId,
        prompt: [{ type: "text", text: refeed ? `${refeed}\n\n${text}` : text }],
      });
      append(t, { kind: "turn_end", turnId, stopReason: result.stopReason });
    } catch (error) {
      // A stopped thread's open turn is ended by restart recovery, not by "connection closed".
      if (!t.stopped) {
        options.providers.invalidate(t.meta.providerId, "The harness turn failed; probe again.");
        append(t, { kind: "error", turnId, message: String((error as Error)?.message ?? error) });
      }
    }
    disarm(t);
    t.running = null;
    if (!t.stopped) runNext(t);
    scheduleIdle(t);
  }

  function runNext(t: Thread) {
    if (options.updatePending?.()) return;
    const next = t.meta.queued.shift();
    if (!next) return;
    writeMeta(t);
    void run(t, next.turnId, next.text);
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
    const url = new URL(request.url);
    const [, , , id, verb] = url.pathname.split("/"); // "", "pe", "threads", id, verb
    const method = request.method;
    // Only routes that read a body require JSON; cancel and delete take none.
    const input = async <T>(schema: z.ZodType<T>) => {
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new NotJson();
      return schema.parse(await request.json());
    };
    if (url.pathname.startsWith("/pe/scope/")) {
      const threadId = decodeURIComponent(url.pathname.slice("/pe/scope/".length));
      if (method === "GET") return json(readHead(threadId));
      if (method !== "PUT") return json({ error: `No route ${method} ${url.pathname}` }, 404);
      const result = setHead(threadId, await input(putTargetSchema));
      return json(result, result.ok ? 200 : 409);
    }
    if (url.pathname === "/pe/threads" && method === "GET")
      return json(
        [...threads.values()].map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    if (url.pathname === "/pe/threads" && method === "POST") {
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
        head: emptyHead,
        queued: [],
        forkOf: null,
      });
      return json(summary(t));
    }
    const t = id ? threads.get(decodeURIComponent(id)) : undefined;
    if (!t) return json({ error: `No thread ${id}` }, 404);
    const key = `${method} ${verb ?? ""}`;
    switch (key) {
      case "GET ":
        return json(body(t));
      case "PUT ": {
        t.meta.title = (await input(z.object({ title: z.string().min(1) }))).title;
        writeMeta(t);
        append(t, { kind: "title_changed", title: t.meta.title });
        return json(summary(t));
      }
      case "DELETE ":
        threads.delete(t.meta.id);
        await stop(t);
        rmSync(join(options.root, t.meta.id), { recursive: true, force: true });
        return new Response(null, { status: 204 });
      case "POST prompt": {
        const { text } = await input(promptRequestSchema);
        if (options.updatePending?.())
          return json({ error: "Pe.Tools is updating; send this after the update finishes." }, 409);
        const turnId = randomUUID();
        if (t.running) {
          t.meta.queued.push({ turnId, text });
          writeMeta(t);
          append(t, { kind: "queued", turnId, text });
          return json({ turnId }, 202);
        }
        void run(t, turnId, text);
        return json({ turnId });
      }
      case "POST cancel": {
        settleAsks(t, "cancel");
        const live = t.running ? await t.live?.catch(() => null) : null;
        if (live) await live.conn.cancel({ sessionId: live.sessionId });
        return json({ cancelled: Boolean(live) });
      }
      case "POST permission": {
        const { requestId, optionId } = await input(permissionResponseSchema);
        return resolvePermission(t, requestId, optionId, "user")
          ? json({ ok: true })
          : json({ error: `No pending permission ${requestId}` }, 409);
      }
      case "POST question": {
        const { requestId, ...answer } = await input(questionResponseSchema);
        return resolveQuestion(t, requestId, answer, "user")
          ? json({ ok: true })
          : json({ error: `No pending question ${requestId}` }, 409);
      }
      // The log is copied whole. Same provider: ACP `session/fork` carries the model context.
      // Another: a new session, and the first prompt carries the transcript (`detached`).
      case "POST fork": {
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
            queued: [],
            forkOf: { threadId: t.meta.id, acpSessionId: same ? t.meta.acpSessionId : null },
          },
          [...t.events],
        );
        return json(summary(forked));
      }
      case "POST model": {
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
              return json(
                {
                  error: `Endpoint model ${modelId} was refused: ${String((error as Error).message ?? error)}`,
                },
                400,
              );
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
      case "POST trait": {
        const { id: traitId, value } = await input(traitRequestSchema);
        await useLive(t, (live) => setTrait(t, live, traitId, value));
        return json(body(t));
      }
      case "GET stream": {
        const after = Number(
          url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0,
        );
        return stream(t, Number.isFinite(after) ? after : 0, request.signal);
      }
    }
    return json({ error: `No route ${method} ${url.pathname}` }, 404);
  }

  // Restart recovery: a turn open in the log ended with the host that ran it. Its open asks expire,
  // the turn ends in an error, and prompts queued behind it run once the harness resumes.
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
    runNext(t);
  }

  return {
    /** Automatic updates wait for every turn and harness action to finish. */
    active: () =>
      [...threads.values()].some(
        (t) => t.running !== null || t.busy > 0 || t.meta.queued.length > 0,
      ),
    /** The thread head store; the `thread-head` Reading observes it. */
    heads,
    /** The web handler for `/pe/threads*` and `/pe/scope/:id`. Bad input is 400; a harness refusal 502. */
    fetch: (request: Request) =>
      handle(request).catch((error) =>
        error instanceof NotJson
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
    close: () => Promise.all([...threads.values()].map(stop)),
  };
}
