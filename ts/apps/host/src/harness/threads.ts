import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import {
  createThreadRequestSchema,
  forkThreadRequestSchema,
  permissionResponseSchema,
  promptRequestSchema,
  putTargetSchema,
  questionResponseSchema,
  threadHeadSchema,
  type HarnessEvent,
  type HarnessId,
  type HarnessInfo,
  type HarnessThreadBody,
  type HarnessThreadSummary,
  type PutTargetResult,
  type ThreadHead,
} from "@pe/agent-contracts";
import { Effect } from "effect";
import { z } from "zod";
import { harnessEndpointEnv, readSaved } from "../inference-endpoint.ts";

/** The thread wire of ADR 0015; contract and route list in `@pe/agent-contracts` `harness-thread.ts`. */

const adapters: Record<HarnessId, { title: string; pkg: string }> = {
  claude: { title: "Claude Code", pkg: "@agentclientprotocol/claude-agent-acp" },
  codex: { title: "Codex", pkg: "@agentclientprotocol/codex-acp" },
};

/** The adapter's bin script, resolved from this package; `PE_HARNESS_ADAPTER_<ID>` overrides it (tests). */
// TODO: installed lane. The SEA bundle has no node_modules beside it, so createRequire cannot find the
// adapters; the installed launch must stage both adapter packages beside Pe.Host.exe and spawn their bin
// with a real node (the SEA's process.execPath is Pe.Host.exe, not node).
function adapterEntry(harness: HarnessId): string {
  const override = process.env[`PE_HARNESS_ADAPTER_${harness.toUpperCase()}`];
  if (override) return override;
  const pkgJson = createRequire(import.meta.url).resolve(`${adapters[harness].pkg}/package.json`);
  const bin = JSON.parse(readFileSync(pkgJson, "utf8")).bin as Record<string, string>;
  return join(dirname(pkgJson), Object.values(bin)[0]!);
}

/** Cheap by design: no spawn. A client probes it to tell a harness-wire host from an older one. */
function listHarnesses(canSpawn: boolean): HarnessInfo[] {
  return (Object.keys(adapters) as HarnessId[]).map((id) => {
    if (!canSpawn)
      return {
        id,
        title: adapters[id].title,
        available: false,
        reason: NO_CHECKOUT,
        authMethods: [],
      };
    try {
      const entry = adapterEntry(id);
      if (!existsSync(entry)) throw new Error(`${entry} does not exist`);
      return { id, title: adapters[id].title, available: true, authMethods: [] };
    } catch (error) {
      return {
        id,
        title: adapters[id].title,
        available: false,
        reason: String(error),
        authMethods: [],
      };
    }
  });
}

type Meta = Omit<HarnessThreadSummary, "lastSeq"> & {
  acpSessionId: string | null;
  modeId: string | null;
  models: HarnessThreadBody["models"];
  modes: HarnessThreadBody["modes"];
  /** The thread head the Pea MCP child reads through `GET /pe/scope/:id`. */
  head: ThreadHead;
  /** Prompts accepted while a turn ran; a restarted host runs them after resume. */
  queued: HarnessThreadBody["queued"];
  /** The thread this one was forked from; `acpSessionId` is null when the fork crossed harnesses. */
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
  /**
   * The Pea MCP server the child launches, bound to `threadId` through `PE_THREAD`; null when this
   * host cannot launch one (installed lane), which refuses new threads with 503.
   */
  mcpServer:
    | ((threadId: string) => {
        name: string;
        command: string;
        args: string[];
        env: { name: string; value: string }[];
      })
    | null;
};

const emptyHead: ThreadHead = { defaultTarget: null, revision: 0 };
const NO_SPAWN =
  "Harness threads need a source checkout: this installed host has no Pea MCP server to hand a harness yet.";
const NO_CHECKOUT = "Harness threads need a source checkout in this build";
/** Thrown by `input` on a body route sent without a JSON content type; served as 415. */
class NotJson extends Error {}
const warn = (message: string) => Effect.runSync(Effect.logWarning(message));

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

/**
 * End stdin, give the adapter 2 s to exit, then kill its whole tree: on win32 `kill()` would leave
 * the adapter's own children (codex app-server, claude CLI, the Pea MCP server) running.
 */
async function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
  child.stdin?.end();
  if (await Promise.race([exited, new Promise<boolean>((r) => setTimeout(r, 2000, false))])) return;
  if (process.platform === "win32" && child.pid)
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  else child.kill();
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
    };
  }

  /** A new thread on disk, spawned now so the model and mode pickers fill before the first prompt. */
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
    const key = readSaved()?.apiKey;
    const line = JSON.stringify({
      ...event,
      seq: t.events.length + 1,
      at: new Date().toISOString(),
    });
    // The saved endpoint key never lands in a thread record, even when a harness echoes it.
    const redacted = key ? line.replaceAll(key, `…${key.slice(-4)}`) : line;
    const full = JSON.parse(redacted) as HarnessEvent;
    t.events.push(full);
    appendFileSync(join(options.root, t.meta.id, "events.jsonl"), `${redacted}\n`);
    for (const listener of t.listeners) listener(full);
    return full;
  }

  const summary = (t: Thread): HarnessThreadSummary => ({
    id: t.meta.id,
    harness: t.meta.harness,
    title: t.meta.title,
    createdAt: t.meta.createdAt,
    updatedAt: t.events.at(-1)?.at ?? t.meta.updatedAt,
    modelId: t.meta.modelId,
    lastSeq: t.events.length,
  });

  const body = (t: Thread): HarnessThreadBody => ({
    ...summary(t),
    models: t.meta.models,
    modes: t.meta.modes,
    modeId: t.meta.modeId,
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
    return true;
  }

  /** Every ask the turn left open ends with the turn. */
  function settleAsks(t: Thread, by: "cancel" | "expired") {
    for (const requestId of t.pending.keys()) resolvePermission(t, requestId, null, by);
    for (const requestId of t.questions.keys()) resolveQuestion(t, requestId, null, by);
  }

  async function connect(t: Thread): Promise<Live> {
    const harness = t.meta.harness;
    if (!options.mcpServer) throw new Error(NO_SPAWN);
    const child = spawn(process.execPath, [adapterEntry(harness)], {
      cwd: options.worldRoot,
      stdio: ["pipe", "pipe", "pipe"],
      // The host env unchanged (a user's own ANTHROPIC_API_KEY stays), plus the saved endpoint.
      env: { ...process.env, ...harnessEndpointEnv(harness) },
      windowsHide: true,
    });
    t.child = child;
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.on("exit", (code, signal) => {
      if (t.session === "closed") return;
      t.session = "closed";
      t.live = null;
      settleAsks(t, "expired");
      append(t, {
        kind: "error",
        turnId: t.running,
        message: `${harness} harness exited (${signal ?? code}): ${stderr.trim().slice(-500)}`,
      });
    });
    const conn = new ClientSideConnection(
      () => ({
        sessionUpdate: ({ update }) => {
          append(t, { kind: "update", turnId: t.running, update });
          if (update.sessionUpdate === "current_mode_update") {
            t.meta.modeId = update.currentModeId;
            writeMeta(t);
            append(t, { kind: "mode_changed", modeId: update.currentModeId });
          }
          if (update.sessionUpdate === "session_info_update" && update.title) {
            t.meta.title = update.title;
            writeMeta(t);
            append(t, { kind: "title_changed", title: update.title });
          }
        },
        requestPermission: (request: RequestPermissionRequest) =>
          new Promise<RequestPermissionResponse>((resolve) => {
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
      ndJsonStream(
        Writable.toWeb(child.stdin!),
        Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
      ),
    );
    const init = await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        elicitation: { form: {} },
      },
    });
    const request = { cwd: options.worldRoot, mcpServers: [options.mcpServer(t.meta.id)] };
    // No session verb restores the user's model and mode (drive 2026-10-01: a sonnet/default
    // thread came back opus/auto), so both are re-applied below.
    const wantModel = t.meta.modelId;
    const wantMode = t.meta.modeId;
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
    const modelOption = configOptions.find((o) => o.category === "model");
    // `models` is the unstable ACP model state (codex answers it); the SDK 1.5.1 type omits it.
    const models = (
      session as {
        models?: { availableModels: { modelId: string; name: string }[]; currentModelId: string };
      }
    ).models;
    t.meta.models =
      models?.availableModels.map(({ modelId, name }) => ({ modelId, name })) ??
      (modelOption?.type === "select"
        ? modelOption.options
            .flatMap((o) => ("options" in o ? o.options : [o]))
            .map((o) => ({ modelId: o.value, name: o.name }))
        : []);
    t.meta.modes = session.modes?.availableModes.map(({ id, name }) => ({ id, name })) ?? [];
    t.meta.modelId =
      models?.currentModelId ?? (modelOption ? String(modelOption.currentValue) : null);
    t.meta.modeId = session.modes?.currentModeId ?? null;
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
    if (wantMode && wantMode !== t.meta.modeId)
      await setMode(t, live, wantMode).catch(notReapplied(`mode ${wantMode}`));
    return live;
  }

  function ensure(t: Thread): Promise<Live> {
    if (!t.live) {
      t.session = "started";
      t.live = connect(t);
      t.live.catch((error) => {
        t.live = null;
        t.session = "closed";
        append(t, {
          kind: "error",
          turnId: t.running,
          message: `${t.meta.harness} harness failed to start: ${String(error?.message ?? error)}`,
        });
      });
    }
    return t.live;
  }

  async function setModel(t: Thread, live: Live, modelId: string) {
    const option = live.configOptions.find((o) => o.category === "model");
    // Codex lists `model[effort]` ids that only the unstable `session/set_model` accepts.
    const setUnstable = () =>
      live.conn.extMethod("session/set_model", { sessionId: live.sessionId, modelId });
    if (option)
      await live.conn
        .setSessionConfigOption({ sessionId: live.sessionId, configId: option.id, value: modelId })
        .catch((error: { code?: number }) => {
          if (error?.code !== -32601) throw error; // JSON-RPC method not found
          return setUnstable();
        });
    else if (t.meta.models.length > 0) await setUnstable();
    else throw new Error(`${t.meta.harness} offers no model choice`);
    t.meta.modelId = modelId;
    writeMeta(t);
    append(t, { kind: "model_changed", modelId });
  }

  async function setMode(t: Thread, live: Live, modeId: string) {
    await live.conn.setSessionMode({ sessionId: live.sessionId, modeId });
    t.meta.modeId = modeId;
    writeMeta(t);
    append(t, { kind: "mode_changed", modeId });
  }

  async function run(t: Thread, turnId: string, text: string) {
    t.running = turnId;
    append(t, { kind: "prompt", turnId, text });
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
      if (!t.stopped)
        append(t, { kind: "error", turnId, message: String((error as Error)?.message ?? error) });
    }
    t.running = null;
    if (!t.stopped) runNext(t);
  }

  function runNext(t: Thread) {
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
    if (url.pathname === "/pe/harnesses" && method === "GET")
      return json(listHarnesses(options.mcpServer !== null));
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
      if (!options.mcpServer) return json({ error: NO_SPAWN }, 503);
      const { harness, title } = await input(createThreadRequestSchema);
      const now = new Date().toISOString();
      const t = create({
        id: randomUUID(),
        harness,
        title: title ?? "New thread",
        createdAt: now,
        updatedAt: now,
        modelId: null,
        acpSessionId: null,
        modeId: null,
        models: [],
        modes: [],
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
        t.session = "closed";
        t.stopped = true;
        threads.delete(t.meta.id);
        await stopChild(t.child);
        rmSync(join(options.root, t.meta.id), { recursive: true, force: true });
        return new Response(null, { status: 204 });
      case "POST prompt": {
        const { text } = await input(promptRequestSchema);
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
      // The log is copied whole. Same harness: ACP `session/fork` carries the model context. Another
      // harness: a new session, and the first prompt carries the transcript (`detached`).
      case "POST fork": {
        if (!options.mcpServer) return json({ error: NO_SPAWN }, 503);
        if (t.running) return json({ error: "Fork after the running turn ends" }, 409);
        const { harness = t.meta.harness, title } = await input(forkThreadRequestSchema);
        const same = harness === t.meta.harness;
        const now = new Date().toISOString();
        const forked = create(
          {
            ...t.meta,
            id: randomUUID(),
            harness,
            title: title ?? `${t.meta.title} (fork)`,
            createdAt: now,
            updatedAt: now,
            acpSessionId: null,
            modelId: same ? t.meta.modelId : null,
            modeId: same ? t.meta.modeId : null,
            models: [],
            modes: [],
            queued: [],
            forkOf: { threadId: t.meta.id, acpSessionId: same ? t.meta.acpSessionId : null },
          },
          [...t.events],
        );
        return json(summary(forked));
      }
      case "POST model": {
        const { modelId } = await input(z.object({ modelId: z.string() }));
        await setModel(t, await ensure(t), modelId);
        return json(summary(t));
      }
      case "POST mode": {
        const { modeId } = await input(z.object({ modeId: z.string() }));
        await setMode(t, await ensure(t), modeId);
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
    /** The thread head store; the `thread-head` Reading observes it. */
    heads,
    /** The web handler for `/pe/harnesses`, `/pe/threads*` and `/pe/scope/:id`. Bad input is 400; a harness refusal 502. */
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
    close: () =>
      Promise.all(
        [...threads.values()].map((t) => {
          t.session = "closed";
          t.stopped = true;
          return stopChild(t.child);
        }),
      ),
  };
}
