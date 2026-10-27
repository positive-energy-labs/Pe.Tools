import type {
  CommandContext,
  CommandEnvironment,
  CommandBinding,
  CommandExecutor,
} from "./command-executor.ts";
import { CommandRejected, StepFailure, refused } from "./command-executor.ts";
import { readJournalSnapshot } from "./legacy-action-journal.ts";
import { validateNativeInput } from "./native-input.ts";
import { bindActionDispatch } from "./action-dispatch.ts";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { renameReplacing } from "./rename-retry.ts";
import { dirname, join, win32 } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import { z } from "zod";
import {
  canonicalRouteInput,
  actionReceiptSchema,
  actionStepSchema,
  actionAdmissionSchema,
  type ActionAdmission,
  type Consumed,
  type Claim,
  type NativeProcess,
  type Effect,
  type WorkKey,
  type RouteStatePatch,
  type RouteStateWriteResult,
  commands,
  editableCells,
  type Command,
  workKey,
  transitionPatches,
  type CellLike,
  type WorkPath,
  type ActionStep,
  type Basis,
  type Footprint,
  type CommandConsent,
  type Caller,
  type DocumentRef,
  type ActionReceipt,
  receiptSchema,
  receiptBodySchema,
  receiptJoinSchema,
  receiptQuerySchema,
  receiptStampSchema,
  receiptMatches,
  type Receipt,
  type ReceiptFact,
  type ReceiptJoin,
  type ReceiptQuery,
  type ReceiptReader,
  type ReceiptStamp,
} from "@pe/agent-contracts";
import {
  live,
  originOf,
  assertRunAdmission,
  authorizeCommand,
  commandCheckpoint,
  subscribeRunChanges,
  validateFootprintCaller,
  Refused,
} from "./control.ts";

/** Who crossed and why it was admitted: host-minted, stamped on the receipt beside the admission. */
export type Crossing = {
  readonly caller: Caller;
  readonly basis: Basis | null;
};

const messageOf = (error: unknown) =>
  error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
const holdsClaims = (row: ActionReceipt) =>
  !(
    (row.state === "failed" || row.state === "cancelled") &&
    row.notDispatched === true &&
    row.steps.every(
      (step) =>
        !step.dispatchedAt &&
        (step.state === "failed" || step.state === "cancelled") &&
        step.notDispatched === true,
    )
  );
const patchSnapshot = (snapshot: unknown, patch: RouteStatePatch): void => {
  if (!snapshot || typeof snapshot !== "object" || !patch.path.length) return;
  let parent = snapshot as Record<string | number, unknown>;
  for (const segment of patch.path.slice(0, -1)) {
    const child = parent[segment];
    if (!child || typeof child !== "object") parent[segment] = {};
    parent = parent[segment] as Record<string | number, unknown>;
  }
  const key = patch.path.at(-1)!;
  if (patch.value === undefined) delete parent[key];
  else parent[key] = structuredClone(patch.value);
};
const valueAt = (root: unknown, path: WorkPath): unknown =>
  path.reduce<unknown>(
    (value, segment) =>
      value && typeof value === "object"
        ? (value as Record<string | number, unknown>)[segment]
        : undefined,
    root,
  );
/** Wildcards keep dictionary membership in the projection, including added/deleted keys. */
const project = (
  document: unknown,
  paths: readonly (readonly (string | number)[])[],
): unknown[] => {
  const at = (value: unknown, path: readonly (string | number)[]): unknown => {
    if (!path.length) return value;
    if (!value || typeof value !== "object") return null;
    const [head, ...tail] = path;
    if (head === "*")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, at(child, tail)]),
      );
    return at((value as Record<string, unknown>)[String(head)], tail);
  };
  return paths.map((path) => at(document, path));
};
const selectDocument = (document: unknown, paths: readonly WorkPath[]) => {
  const wanted = (path: WorkPath) =>
    paths.filter((pattern) =>
      path.every((part, i) => i < pattern.length && (pattern[i] === "*" || pattern[i] === part)),
    );
  const visit = (value: unknown, path: WorkPath): unknown => {
    const matching = wanted(path);
    if (matching.some((pattern) => pattern.length === path.length)) return value;
    if (!value || typeof value !== "object") return undefined;
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
      const at = [...path, Array.isArray(value) ? Number(key) : key];
      if (wanted(at).length) (result as Record<string, unknown>)[key] = visit(child, at);
    }
    return result;
  };
  return z.json().parse(JSON.parse(JSON.stringify(visit(document, []) ?? {})));
};
const selectedEdits = (document: unknown, paths: readonly WorkPath[]) =>
  editableCells(document, paths)
    .filter(({ cell }) => cell.edit != null)
    .map(({ path, cell }) => ({ path, edit: cell.edit }))
    .sort((a, b) => canonicalRouteInput(a.path).localeCompare(canonicalRouteInput(b.path)));

const sameCaller = (a: Caller, b: Caller) =>
  a.kind === b.kind &&
  (a.kind === "pea" && b.kind === "pea"
    ? a.thread === b.thread
    : a.kind === "human" && b.kind === "human"
      ? a.via === b.via && a.login === b.login && a.device === b.device
      : canonicalRouteInput(a) === canonicalRouteInput(b));
const pathInside = (root: string, path: string) => {
  const relative = win32.relative(win32.resolve(root), win32.resolve(path));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith("..\\") && !win32.isAbsolute(relative))
  );
};
const effectsOverlap = (a: Footprint, b: Footprint) =>
  a.some((x) =>
    b.some((y) => {
      if (x.kind === "document" && y.kind === "session") return x.ref.session === y.session;
      if (x.kind === "session" && y.kind === "document") return x.session === y.ref.session;
      if (x.kind === "member" && y.kind === "member" && x.pod === y.pod && x.path === y.path)
        return true;
      const xPath =
        x.kind === "member"
          ? x.location
          : x.kind === "file" || x.kind === "directory"
            ? x.path
            : undefined;
      const yPath =
        y.kind === "member"
          ? y.location
          : y.kind === "file" || y.kind === "directory"
            ? y.path
            : undefined;
      if (xPath && yPath)
        return x.kind === "directory"
          ? pathInside(xPath, yPath) || (y.kind === "directory" && pathInside(yPath, xPath))
          : y.kind === "directory"
            ? pathInside(yPath, xPath)
            : win32.relative(xPath, yPath) === "";
      if (
        (x.kind === "member" && !x.location && (y.kind === "file" || y.kind === "directory")) ||
        (y.kind === "member" && !y.location && (x.kind === "file" || x.kind === "directory"))
      )
        return true;
      return canonicalRouteInput(x) === canonicalRouteInput(y);
    }),
  );

export type StepOptions<A> = {
  process?: NativeProcess;
  /** Domain postcondition, evaluated only after the operation returned a concrete outcome. */
  check?(result: A): void;
  releases?(
    result: A,
  ): { action: string; claim: Claim }[] | Promise<{ action: string; claim: Claim }[]>;
};
export type ActionExecution = {
  step<A>(
    kind: ActionStep["kind"],
    key: string,
    input: unknown,
    execute: (requestId: string) => Promise<A>,
    options?: StepOptions<A>,
  ): Promise<A>;
  effect(effect: Effect): Promise<void>;
  publishWork(
    key: WorkKey,
    route: string,
    patches: readonly RouteStatePatch[],
  ): Promise<Extract<RouteStateWriteResult, { ok: true }>>;
  retireWork(
    key: WorkKey,
    route: string,
    paths: readonly WorkPath[],
  ): Promise<{ retired: WorkPath[]; revision: number }>;
  readonly prepared: unknown;
  recorded(kind: ActionStep["kind"], key: string): ActionStep | undefined;
  retire(id: string, reason: string): Promise<ActionStep>;
};
/** The bridge answers a cancelled request 499 (BridgeOperationExceptions.CancelledStatusCode). */
const CANCELLED_STATUS = 499;
type DispatchFailure =
  | Pick<
      Extract<ActionReceipt, { state: "failed" }>,
      "state" | "error" | "status" | "nativeOutcome" | "issues" | "notDispatched" | "evidence"
    >
  | Pick<
      Extract<ActionReceipt, { state: "unknown" }>,
      "state" | "error" | "status" | "nativeOutcome" | "issues" | "evidence"
    >
  | Pick<
      Extract<ActionReceipt, { state: "cancelled" }>,
      "state" | "error" | "status" | "notDispatched"
    >;
/** One error's step-level answer: refused before dispatch, cancelled, or uncertain. */
const failure = (error: unknown): DispatchFailure => {
  if (error instanceof ActionIncomplete)
    return {
      state: "failed",
      error: error.message,
      status: 409,
      notDispatched: true,
      evidence: { result: error.result },
    };
  if (error instanceof CommandRejected)
    return { state: "failed", error: error.message, status: 409, notDispatched: true };
  if (error instanceof StepFailure) {
    const detail = {
      error: error.message,
      status: error.status,
      ...(error.result === undefined ? {} : { evidence: { result: error.result } }),
      ...(error.details?.nativeOutcome ? { nativeOutcome: error.details.nativeOutcome } : {}),
      ...(error.details?.issues ? { issues: [...error.details.issues] } : {}),
    };
    if (error.outcome === "refused")
      return error.status === CANCELLED_STATUS
        ? { state: "cancelled", error: error.message, status: error.status, notDispatched: true }
        : { ...detail, state: "failed", notDispatched: true };
    if (error.outcome === "cancelled")
      return { state: "cancelled", error: error.message, status: error.status };
    return { ...detail, state: error.outcome === "failed" ? "failed" : "unknown" };
  }
  const problem = error as { message?: string; statusCode?: number } | null;
  // Exception spelling and legacy flags are not independent evidence of a completed effect.
  return {
    state: "unknown",
    error: problem?.message ?? String(error),
    status: problem?.statusCode ?? 503,
  };
};

const interruptedSteps = (steps: readonly ActionStep[]): ActionStep[] =>
  steps.map((step) =>
    step.state === "running"
      ? {
          ...step,
          state: "unknown",
          error: "Execution ended without a durable step outcome",
          status: 503,
        }
      : step,
  );

export class ActionIncomplete extends Error {
  constructor(
    message: string,
    readonly result: unknown,
  ) {
    super(message);
  }
}

/** What ended an attempt: its executor returned or threw, recovery read receipts, or the host stopped. */
type SettleCause =
  | { kind: "returned"; result: unknown }
  | { kind: "threw"; error: unknown }
  | { kind: "recovered" }
  | { kind: "interrupted" };
/** A terminal state and its fields; every caller parses the whole receipt against the schema. */
type Settled = { state: Exclude<ActionReceipt["state"], "running" | "waiting"> } & Record<
  string,
  unknown
>;

/**
 * The one terminal decision for an attempt, from its preparation, its recorded steps, and what ended
 * it. Every effect is a recorded step, so:
 * - an uncertain step is never hidden: the attempt is unknown and nothing redispatches it;
 * - cancelled is a settled answer, never a rollback claim;
 * - a known succeeded effect is never erased: a later failure makes the attempt incomplete;
 * - with no effect, a failure is failed and not dispatched.
 * `null` means recovery proved nothing new and the attempt keeps its state.
 */
function settle(
  prepared: boolean,
  steps: readonly ActionStep[],
  cause: SettleCause,
): Settled | null {
  const thrown = cause.kind === "threw" ? failure(cause.error) : undefined;
  const reason =
    thrown ??
    (cause.kind === "interrupted"
      ? { error: "Host restarted before the executor recorded an outcome", status: 503 }
      : undefined);
  const uncertain = steps.find((step) => step.state === "unknown" || step.state === "running");
  if (uncertain) {
    if (cause.kind === "recovered")
      return {
        state: "unknown",
        error:
          "error" in uncertain ? uncertain.error : `Step '${uncertain.key}' has no proven outcome`,
        status: "status" in uncertain ? uncertain.status : 503,
      };
    const detail =
      thrown?.state === "unknown"
        ? thrown
        : {
            error: `Step '${uncertain.key}' has no proven outcome${reason ? `; ${reason.error}` : ""}`,
            status: 503,
          };
    return { ...detail, state: "unknown" };
  }
  if (thrown?.state === "cancelled") {
    const { notDispatched: _notDispatched, ...cancelled } = thrown;
    return {
      ...cancelled,
      ...(thrown.notDispatched &&
      steps.every(
        (step) =>
          !step.dispatchedAt &&
          (step.state === "failed" || step.state === "cancelled") &&
          step.notDispatched,
      )
        ? { notDispatched: true }
        : {}),
    };
  }
  if (!prepared)
    return {
      state: "failed",
      error: reason?.error ?? "Preparation did not finish",
      status: 409,
      notDispatched: true,
      ...(thrown && "issues" in thrown && thrown.issues ? { issues: thrown.issues } : {}),
    };
  if (cause.kind === "returned") return { state: "succeeded", result: cause.result ?? null };
  const cancelled =
    cause.kind !== "threw" ? steps.find((step) => step.state === "cancelled") : undefined;
  if (cancelled?.state === "cancelled")
    return { state: "cancelled", error: cancelled.error, status: cancelled.status };
  const failedStep = [...steps].reverse().find((step) => step.state === "failed");
  const why = reason ?? (failedStep?.state === "failed" ? failedStep : undefined);
  if (steps.some((step) => step.state === "succeeded" && step.kind !== "publication")) {
    if (!why) return null;
    return {
      state: "incomplete",
      error: why.error,
      status: why.status,
      result:
        cause.kind === "threw" && cause.error instanceof ActionIncomplete
          ? cause.error.result
          : null,
    };
  }
  if (!why) return null;
  return {
    state: "failed",
    error: why.error,
    status: why.status,
    ...(steps.length === 0 ||
    steps.every(
      (step) =>
        !step.dispatchedAt &&
        (step.state === "failed" || step.state === "cancelled") &&
        step.notDispatched === true,
    )
      ? { notDispatched: true }
      : {}),
    ...(thrown && "nativeOutcome" in thrown && thrown.nativeOutcome
      ? { nativeOutcome: thrown.nativeOutcome }
      : {}),
    ...(thrown && "issues" in thrown && thrown.issues ? { issues: thrown.issues } : {}),
    ...((failedStep?.state === "failed" && failedStep.evidence) ||
    (why && "evidence" in why && why.evidence)
      ? {
          evidence:
            failedStep?.state === "failed"
              ? failedStep.evidence
              : thrown && "evidence" in thrown
                ? thrown.evidence
                : undefined,
        }
      : {}),
  };
}

/** The attempt without its terminal fields, so a new settlement never inherits a stale one. */
const unsettled = (row: ActionReceipt) => {
  const {
    state: _state,
    error: _error,
    status: _status,
    notDispatched: _notDispatched,
    result: _result,
    nativeOutcome: _nativeOutcome,
    issues: _issues,
    evidence: _evidence,
    ...attempt
  } = row as ActionReceipt & Record<string, unknown>;
  return attempt;
};

/** Telemetry facts kept by compaction; command identities and outcomes never expire. */
const RETAIN_RECEIPTS = 10_000;
/** A row that blocks overlapping admissions and must stay visible until recovered. */
const isOpen = (row: ActionReceipt) =>
  row.state === "waiting" ||
  row.state === "running" ||
  row.state === "unknown" ||
  row.state === "incomplete";

/**
 * One host journal. Execution never holds the authored Work lock or the journal write tail.
 *
 * Storage is append-only lines: a `{"version":7}` header, then one `{receipt}` per committed
 * revision and one `{mapping}` per minted opaque id; the last revision of an id wins. A commit
 * appends only what it changed, and compaction rewrites the newest {@link RETAIN_RECEIPTS} telemetry
 * facts plus every command once the file holds twice what is live.
 */
export class ActionJournal implements ReceiptReader {
  private readonly rows = new Map<string, ActionReceipt>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly mappings = new Map<string, string>();
  /** Action id to its receipt id, and step id to its action id. */
  private readonly actionReceipt = new Map<string, string>();
  private readonly stepAction = new Map<string, string>();
  private readonly open = new Set<string>();
  /** Mapping keys minted since the last append, and since the last compaction. */
  private fresh: string[] = [];
  private minted = new Set<string>();
  private lines = 0;
  private factCount = 0;
  private header = false;
  private torn = false;
  private committed: Receipt[] = [];
  private readonly subscribers = new Set<(receipt: Receipt) => void>();
  private loaded?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<ActionReceipt>>();
  // Page authority is a host-minted object capability, never reconstructed from persisted data.
  private readonly activeCallers = new Map<string, Caller>();
  private environment?: CommandEnvironment;
  private readonly cancelWaits = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private readonly reads = new OwnerReads();
  constructor(
    private readonly path: string,
    private readonly stamp: () => ReceiptStamp | null = () => null,
    private readonly retain = RETAIN_RECEIPTS,
  ) {}
  /** Bound once when the host/demo/test runtime acquires its exact bridge and Work owner. */
  bindCommands(environment: CommandEnvironment): void {
    if (this.environment) throw Error("This journal already has its command environment");
    this.environment = Object.freeze(environment);
  }

  private loadOnce(): Promise<void> {
    return (this.loaded ??= this.load());
  }

  async read(query: ReceiptQuery): Promise<Receipt[]> {
    const q = receiptQuerySchema.parse(query);
    await this.loadOnce();
    await this.tail;
    return structuredClone([...this.receipts.values()].filter((r) => receiptMatches(r, q)));
  }
  subscribe(query: ReceiptQuery, consume: (receipt: Receipt) => void): () => void {
    const q = receiptQuerySchema.parse(query);
    const listener = (r: Receipt) => {
      if (receiptMatches(r, q)) consume(structuredClone(r));
    };
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
  private mapped(kind: string, localId: string): string {
    const key = JSON.stringify([kind, localId]);
    let id = this.mappings.get(key);
    if (!id) {
      id = randomUUID();
      this.mappings.set(key, id);
      this.fresh.push(key);
      this.minted.add(key);
    }
    return id;
  }
  async opaqueId(
    kind: "thread" | "turn" | "process" | "request",
    localId: string,
  ): Promise<string> {
    return this.serial(async () => {
      const id = this.mapped(kind, localId);
      await this.commit();
      this.notify();
      return id;
    });
  }
  private rootJoin(id: string): ReceiptJoin {
    return { actionId: this.mapped("action", id), requestId: this.mapped("action-request", id) };
  }
  async actionJoin(id: string): Promise<ReceiptJoin> {
    return this.serial(async () => {
      const join = this.rootJoin(id);
      await this.commit();
      this.notify();
      return join;
    });
  }
  private joinForRequest(id: string): ReceiptJoin {
    const action = this.stepAction.get(id);
    const root = action ? this.rootJoin(action) : null;
    return {
      requestId: z.uuid().safeParse(id).success ? id : this.mapped("request", id),
      ...(root ? { actionId: root.actionId, parentRequestId: root.requestId } : {}),
    };
  }
  async requestJoin(id: string): Promise<ReceiptJoin> {
    return this.serial(async () => {
      const join = this.joinForRequest(id);
      await this.commit();
      this.notify();
      return join;
    });
  }
  /** Only owner code admits stamps. HTTP producers submit facts through a verified adapter. */
  async recordFact(
    body: ReceiptFact,
    join: ReceiptJoin = { requestId: randomUUID() },
    stamp: ReceiptStamp | null = this.stamp(),
    source?: Pick<Receipt, "id" | "at">,
  ): Promise<Receipt> {
    const fact = receiptBodySchema.parse(body);
    if (fact.kind === "action") throw Error("Only action execution can settle an action receipt");
    const admitted = {
      body: fact,
      join: receiptJoinSchema.parse(join),
      stamp: stamp === null ? null : receiptStampSchema.parse(stamp),
    };
    const identity = source
      ? { id: z.uuid().parse(source.id), at: z.iso.datetime().parse(source.at) }
      : undefined;
    return this.serial(() => this.appendFact(admitted, identity));
  }
  private async appendFact(
    fact: Pick<Receipt, "body" | "join" | "stamp">,
    source?: Pick<Receipt, "id" | "at">,
  ): Promise<Receipt> {
    const receipt = receiptSchema.parse({
      schema: 1,
      id: randomUUID(),
      revision: 1,
      at: new Date().toISOString(),
      ...source,
      ...fact,
    });
    const previous = this.receipts.get(receipt.id);
    if (previous) {
      if (canonicalRouteInput(previous) !== canonicalRouteInput(receipt))
        throw Error("Receipt id conflicts with its committed fact");
      return structuredClone(previous);
    }
    await this.commit([], [receipt]);
    this.notify();
    return structuredClone(receipt);
  }
  async recordQueue(
    op: string,
    requestId: string,
    session: string,
    phase: "queued" | "started",
    depth: number,
    waitMs?: number,
  ): Promise<Receipt> {
    return this.serial(() =>
      this.appendFact({
        body: {
          kind: "queue",
          op,
          phase,
          depth,
          ...(waitMs === undefined ? {} : { waitMs }),
          processSessionId: this.mapped("process", session),
        },
        join: this.joinForRequest(requestId),
        stamp: this.stamp(),
      }),
    );
  }

  /** The committed step index also fences native work after it has waited in the bridge queue. */
  async validateDispatch(requestId: string): Promise<string | null> {
    const action = this.stepAction.get(requestId);
    try {
      if (action) await this.gate(this.rows.get(action)!, "dispatch");
    } catch (error) {
      return String(error);
    }
    return this.dispatchRefusal(requestId);
  }
  async markDispatched(requestId: string) {
    await this.serial(async () => {
      const action = this.stepAction.get(requestId),
        row = action ? this.rows.get(action) : undefined;
      if (!row) return;
      await this.commit([
        {
          ...row,
          steps: row.steps.map((step) =>
            step.id === requestId ? { ...step, dispatchedAt: new Date().toISOString() } : step,
          ),
        },
      ]);
      this.notify();
    });
  }
  dispatchRefusal(requestId: string): string | null {
    const action = this.stepAction.get(requestId);
    const row = action ? this.rows.get(action) : undefined;
    if (!row) return null;
    if (row.cancellationRequested) return "Action cancelled before dispatch";
    try {
      if (row.effects.length) commandCheckpoint(originOf(row.caller), row.consent);
      validateFootprintCaller(this.activeCallers.get(row.id) ?? row.caller, row.effects);
    } catch (error) {
      return String(error);
    }
    return live(row.basis, "native dispatch")?.message ?? null;
  }

  async list(target?: DocumentRef, id?: string): Promise<ActionReceipt[]> {
    await this.loadOnce();
    // Rows enter this map after durable append. Readers need the committed snapshot, not the
    // writer's tail: a binder may read Machine, whose acquisition census reads this journal.
    const rows = id ? [this.rows.get(id)].filter((row) => row !== undefined) : this.rows.values();
    return structuredClone(
      [...rows].filter(
        (row) =>
          (!target ||
            (row.target.kind === "document" &&
              row.target.ref.session === target.session &&
              row.target.ref.openId === target.openId)) &&
          (!id || row.id === id),
      ),
    );
  }
  observe(
    target: DocumentRef | undefined,
    id: string | undefined,
    listener: (value: OwnerValue<ActionReceipt[]>) => void,
  ): () => void {
    return this.reads.observe(
      canonicalRouteInput([target ?? null, id ?? null]),
      () => this.list(target, id),
      (notify) => {
        this.listeners.add(notify);
        return () => {
          this.listeners.delete(notify);
        };
      },
      listener,
    );
  }
  private notify() {
    const committed = this.committed.splice(0);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Action receipt listener failed", error);
      }
    }
    for (const receipt of committed)
      for (const listener of this.subscribers) {
        try {
          listener(receipt);
        } catch (error) {
          console.error("Receipt subscriber failed", error);
        }
      }
  }
  async wait(id: string): Promise<ActionReceipt> {
    await this.loadOnce();
    const pending = this.pending.get(id);
    if (pending) return pending;
    const row = (await this.list(undefined, id))[0];
    if (!row) throw Error(`Action '${id}' has no admitted receipt`);
    return row;
  }
  /**
   * Exported inputs of one action, keyed by its original ID. Structured request evidence the host
   * serialized before dispatch; never original authored bytes and never a settled outcome.
   */
  async outputs(id: string): Promise<{ id: string; home: string; files: Record<string, unknown> }> {
    const home = this.home(id);
    const names = await readdir(home, { recursive: true, withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const files: Record<string, unknown> = {};
    for (const entry of names)
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const path = join(entry.parentPath, entry.name);
        files[path.slice(home.length + 1).replaceAll("\\", "/")] = JSON.parse(
          await readFile(path, "utf8"),
        );
      }
    return { id, home, files };
  }
  /** One output home per action ID; hashed because IDs are caller text, not safe path segments. */
  private home(id: string) {
    return join(
      dirname(this.path),
      "action-outputs",
      createHash("sha256").update(id).digest("hex"),
    );
  }
  private async export(id: string, name: string, value: unknown) {
    const file = join(this.home(id), name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), "utf8");
    await renameReplacing(`${file}.tmp`, file);
  }
  private async waitForTurn(id: string) {
    for (;;) {
      const row = this.rows.get(id)!;
      await this.gate(row, "turn");
      const earlier = [...this.rows.values()].slice(0, [...this.rows.keys()].indexOf(id));
      const blocked = earlier.find(
        (other) =>
          isOpen(other) &&
          !this.reconciles(row, other) &&
          effectsOverlap(row.effects, other.effects),
      );
      if (!blocked) return;
      if (blocked.state === "unknown" || blocked.state === "incomplete")
        throw refused(
          `Action '${blocked.id}' requires recovery before this mutation`,
          "effect.recovery",
        );
      await new Promise<void>((resolve) => {
        const changed = () => {
          this.listeners.delete(changed);
          resolve();
        };
        this.listeners.add(changed);
      });
    }
  }

  private claimsOf(row: ActionReceipt): Claim[] {
    if (!holdsClaims(row)) return [];
    return row.claims.filter(
      (claim) =>
        (claim.kind !== "reconciliation" ||
          row.state !== "cancelled" ||
          row.steps.some((step) => step.state === "unknown" || step.state === "running")) &&
        ![...this.rows.values()].some((other) =>
          other.steps.some(
            (step) =>
              step.kind === "native" &&
              step.state === "succeeded" &&
              step.dispatchedAt &&
              step.releases?.some(
                (release) =>
                  release.action === row.id &&
                  canonicalRouteInput(release.claim) === canonicalRouteInput(claim),
              ),
          ),
        ),
    );
  }
  private reconciles(row: ActionReceipt, original: ActionReceipt): boolean {
    return row.claims.some((claim) => claim.kind === "reconciliation" && claim.id === original.id);
  }

  visibleTo(row: ActionReceipt, caller: Caller): boolean {
    if (caller.kind === "human")
      return (
        caller.via === "local" ||
        caller.via === "cli" ||
        row.caller.kind === "pea" ||
        (row.caller.kind === "human" &&
          row.caller.device === caller.device &&
          row.caller.login === caller.login)
      );
    if (caller.kind === "pea")
      return (
        row.caller.kind === "pea" &&
        (row.caller.thread === caller.thread ||
          (caller.root !== undefined &&
            canonicalRouteInput(originOf(row.caller)?.root) === canonicalRouteInput(caller.root)))
      );
    if (caller.kind === "page")
      return row.caller.kind === "page" && row.caller.page === caller.page;
    if (caller.kind === "external-mcp")
      return (
        row.caller.kind === "external-mcp" &&
        (row.caller.context === caller.context ||
          (caller.device !== undefined && row.caller.device === caller.device))
      );
    return false;
  }
  async readFor(caller: Caller, target?: DocumentRef, id?: string): Promise<ActionReceipt[]> {
    if (caller.kind === "anonymous" || caller.kind === "service")
      throw new Refused({
        code: "context.missing",
        door: "/actions",
        reason: "Authenticate before inspecting command inputs or outcomes",
      });
    const rows = await this.list(target, id),
      visible = rows.filter((row) => this.visibleTo(row, caller));
    if (id && rows.length && !visible.length)
      throw new Refused({
        code: "context.foreign-thread",
        door: "/actions",
        reason: "This command belongs to another authenticated caller",
      });
    return visible;
  }
  private context(
    admission: ActionAdmission,
    crossing: Crossing,
    consumed: Consumed[],
  ): CommandContext {
    const workspace = this.environment?.work;
    const cached = new Map<string, { doc: unknown; revision: number }>();
    const context: CommandContext = {
      admission,
      ...crossing,
      get work() {
        if (!workspace) throw refused("Work is unavailable", "work.unavailable");
        return workspace;
      },
      consumed,
      selectWork: async (spec, handle, select) => {
        if (handle.key.route !== spec.route)
          throw refused("Work belongs to another tool", "work.route");
        const identity = workKey(handle.key);
        let original = context.consumed.find(
          (value) => value.kind === "work" && workKey(value.probe.handle.key) === identity,
        );
        let view = cached.get(identity);
        if (!view) {
          if (original?.kind === "work") {
            if (original.probe.handle.revision !== handle.revision)
              throw Error("Resume changed its observed Work revision");
            view = { doc: structuredClone(original.expected), revision: handle.revision };
          } else {
            const current = await workspace?.view(handle.key, spec.route);
            if (!current) throw refused("Work is unavailable", "work.unavailable");
            if (current.revision !== handle.revision)
              throw new CommandRejected({ kind: "stale_revision", handle, live: current.revision });
            view = structuredClone({ doc: current.doc, revision: current.revision });
          }
          cached.set(identity, view);
        }
        const doc = spec.schema.parse(view.doc);
        const cells = editableCells(doc, spec.editable);
        const selection = select?.(doc, cells) ?? {};
        const selected =
          selection.cells ?? cells.filter(({ cell }) => cell.edit != null).map(({ path }) => path);
        const edits = [
          ...(selection.edits ?? []),
          ...(original?.kind === "work" ? (original.probe.edits ?? []) : []),
        ].map((path) => [...path]);
        for (const path of [...selected, ...edits])
          if (
            !spec.editable.some(
              (pattern) =>
                pattern.length === path.length &&
                pattern.every((part, i) => part === "*" || part === path[i]),
            )
          )
            throw Error("A command selected a cell outside its tool contract");
        const paths = [
          ...selected.map((path) => [...path, "edit"]),
          ...selectedEdits(doc, edits).map(({ path }) => [...path, "edit"]),
          ...(selection.facts ?? []).map((path) => [...path]),
        ].filter(
          (path, i, all) =>
            all.findIndex((other) => canonicalRouteInput(other) === canonicalRouteInput(path)) ===
            i,
        );
        if (original?.kind === "work") paths.push(...original.probe.paths);
        const expected = selectDocument(doc, paths);
        const dependency: Consumed = {
          kind: "work",
          probe: { handle, paths, ...(edits.length ? { edits } : {}) },
          expected,
        };
        context.consumed = context.consumed.filter((value) => value !== original);
        context.consumed.push(dependency);
        return doc;
      },
      read: {
        receipts: (id) =>
          structuredClone(
            id
              ? [this.rows.get(id)].filter((value): value is ActionReceipt => value !== undefined)
              : [...this.rows.values()],
          ),
      },
    };
    return context;
  }

  /** One predicate at every async boundary; domain executors declare only the facts it reads. */
  private async gate(
    row: ActionReceipt,
    moment: "admit" | "authorize" | "consented" | "turn" | "prepared" | "step" | "dispatch",
    postcondition = false,
  ): Promise<void> {
    if (row.cancellationRequested)
      throw new StepFailure("Command cancelled before dispatch", 499, "refused");
    if (row.effects.length) {
      if (moment === "admit" || moment === "authorize") assertRunAdmission(originOf(row.caller));
      else
        try {
          commandCheckpoint(originOf(row.caller), row.consent);
        } catch (error) {
          throw new StepFailure(messageOf(error), 499, "refused");
        }
    }
    const dead = live(row.basis, moment);
    if (dead)
      throw new CommandRejected({ kind: "trust", code: dead.refusal.code, message: dead.message });
    try {
      validateFootprintCaller(this.activeCallers.get(row.id) ?? row.caller, row.effects);
    } catch (error) {
      if (!(error instanceof Refused) || moment === "admit") throw error;
      throw new CommandRejected({
        kind: "trust",
        code: error.refusal.code,
        message: error.message,
      });
    }
    for (const dependency of row.consumes) {
      if (dependency.kind === "work") {
        // Retirement compares each submitted cell against live Work itself.
        if (postcondition) continue;
        const current = await this.environment?.work?.view(
          dependency.probe.handle.key,
          dependency.probe.handle.key.route,
        );
        if (!current) throw new CommandRejected({ kind: "stale", consumed: [dependency] });
        if (
          moment === "admit" &&
          row.prepared.state === "unprepared" &&
          current.revision !== dependency.probe.handle.revision
        )
          throw new CommandRejected({
            kind: "stale_revision",
            handle: dependency.probe.handle,
            live: current.revision,
          });
        const snapshot = structuredClone(dependency.expected);
        const currentDocument = structuredClone(current.doc);
        for (const step of row.steps) {
          if (
            step.state !== "succeeded" ||
            step.kind !== "publication" ||
            (step.key !== "work.publish" && step.key !== "work.retire")
          )
            continue;
          const own = step.input as { work: WorkKey; patches?: RouteStatePatch[] };
          if (workKey(own.work) !== workKey(dependency.probe.handle.key)) continue;
          const retired =
            step.key === "work.retire"
              ? (step.result as { patches: RouteStatePatch[]; fulfilled: WorkPath[] })
              : undefined;
          for (const patch of own.patches ?? retired?.patches ?? []) patchSnapshot(snapshot, patch);
          for (const path of retired?.fulfilled ?? []) {
            patchSnapshot(snapshot, { path: [...path] });
            patchSnapshot(currentDocument, { path: [...path] });
          }
        }
        if (
          canonicalRouteInput(project(currentDocument, dependency.probe.paths)) !==
            canonicalRouteInput(project(snapshot, dependency.probe.paths)) ||
          canonicalRouteInput(selectedEdits(currentDocument, dependency.probe.edits ?? [])) !==
            canonicalRouteInput(selectedEdits(snapshot, dependency.probe.edits ?? []))
        )
          throw new CommandRejected({ kind: "stale", consumed: [dependency] });
      } else {
        // A recorded write explains only facts in its declared destination. Source facts
        // outside that footprint still gate every continuation and conditional retirement.
        const ownWrite = row.steps.some(
          (step) =>
            step.state === "succeeded" &&
            ((dependency.kind === "document-mark" &&
              step.kind === "native" &&
              step.dispatchedAt &&
              row.target.kind === "document" &&
              canonicalRouteInput(row.target.ref) === canonicalRouteInput(dependency.probe.ref) &&
              row.effects.some(
                (effect) =>
                  effect.kind === "document" &&
                  canonicalRouteInput(effect.ref) === canonicalRouteInput(dependency.probe.ref),
              )) ||
              (dependency.kind === "file" &&
                step.kind === "file" &&
                row.effects.some(
                  (effect) => effect.kind === "file" && effect.path === dependency.probe.path,
                )) ||
              (dependency.kind === "member" &&
                step.kind === "file" &&
                row.effects.some(
                  (effect) =>
                    effect.kind === "member" &&
                    effect.pod === dependency.probe.pod &&
                    effect.path === dependency.probe.path,
                ))),
        );
        if (ownWrite) continue;
        if (!this.environment) throw Error("Command resource probes are unavailable");
        const current = await this.environment.probe(dependency);
        if (canonicalRouteInput(current) !== canonicalRouteInput(dependency.expected))
          throw new CommandRejected({ kind: "stale", consumed: [dependency] });
      }
    }
  }

  /** Identity, binding, reservations and execution have one owner and one durable row. */
  async resume(id: string, crossing: Crossing): Promise<ActionReceipt> {
    const row = (await this.readFor(crossing.caller, undefined, id))[0];
    if (!row || !this.environment) throw Error("Original command or its executor is unavailable");
    return this.invoke(
      { id: row.id, key: row.key, target: row.target, input: row.input },
      crossing,
      true,
    );
  }

  async invoke(raw: ActionAdmission, crossing: Crossing, resume = false): Promise<ActionReceipt> {
    const admission = actionAdmissionSchema.parse(structuredClone(raw));
    const portable = commands[admission.key as keyof typeof commands];
    if (portable)
      admission.input = portable.input.parse(admission.input) as Record<string, unknown>;
    return this.serial(async () => {
      const prior = this.rows.get(admission.id);
      if (prior && !sameCaller(prior.caller, crossing.caller))
        throw Error("Command id belongs to another authenticated caller");
      if (prior) {
        const identity = { id: prior.id, key: prior.key, target: prior.target, input: prior.input };
        if (canonicalRouteInput(identity) !== canonicalRouteInput(admission))
          throw new CommandRejected({
            kind: "domain",
            code: "id-conflict",
            message: `request id '${admission.id}' conflicts with its admitted intent or target`,
          });
        if (!resume || (prior.state !== "unknown" && prior.state !== "incomplete"))
          return structuredClone(prior);
        if (prior.refusal?.kind === "domain" && prior.refusal.code === "historical-schema")
          throw Error(
            "Historical schema cannot authorize resumed execution; inspect its archived journal",
          );
        if (prior.prepared.state !== "ready")
          throw Error("Original consumed values were not frozen; cannot resume this attempt");
        if (prior.steps.some((step) => step.state === "unknown" || step.state === "running"))
          throw Error("Recover every uncertain step before resuming the original action");
        const reconciliation = [...this.rows.values()].find(
          (other) =>
            other.id !== prior.id &&
            this.claimsOf(other).some(
              (claim) => claim.kind === "reconciliation" && claim.id === prior.id,
            ),
        );
        if (reconciliation)
          throw new CommandRejected({
            kind: "claimed",
            claim: { kind: "reconciliation", id: prior.id },
            by: reconciliation.id,
          });
      }
      const context = this.context(admission, crossing, prior?.consumes ?? []);
      let executor!: CommandExecutor;
      let definition!: Command;
      let binding: CommandBinding | undefined;
      let row: ActionReceipt = {
        id: admission.id,
        key: admission.key,
        caller: crossing.caller,
        basis: crossing.basis,
        target: structuredClone(admission.target),
        input: structuredClone(admission.input),
        consumes: prior?.consumes ?? [],
        claims: prior?.claims ?? [],
        effects: prior?.effects ?? [],
        consent: null,
        steps: prior?.steps ?? [],
        prepared: prior?.prepared ?? { state: "unprepared" },
        recovery: prior?.recovery ?? [],
        startedAt: prior?.startedAt ?? new Date().toISOString(),
        state: "running",
      };
      try {
        if (!this.environment) throw Error("Command environment is unavailable");
        executor = this.environment.resolve(admission.key);
        definition =
          typeof executor.definition === "function"
            ? await executor.definition(context)
            : executor.definition;
        admission.input = definition.input.parse(admission.input) as Record<string, unknown>;
        if (
          definition.principal &&
          !definition.principal.some((principal) => principal === crossing.caller.kind)
        )
          throw refused("This caller lacks the command's required capability", "caller.ineligible");
        const expectedTarget = definition.target?.(admission.input);
        if (
          expectedTarget &&
          canonicalRouteInput(expectedTarget) !== canonicalRouteInput(admission.target)
        )
          throw new CommandRejected({
            kind: "domain",
            code: "target.mismatch",
            message: "Target differs from this command's explicit selection",
          });
        if (
          !expectedTarget &&
          (definition.needs === "nothing"
            ? admission.target.kind !== "host"
            : definition.needs === "session"
              ? admission.target.kind !== "session"
              : admission.target.kind !== "document")
        )
          throw new CommandRejected({
            kind: "domain",
            code: "target.required",
            message: "Target does not match the command contract",
          });
        await this.environment?.target?.(admission.target, definition.needs);
        if (prior?.prepared.state === "ready") executor.prepared.parse(prior.prepared.value);
        row = { ...row, input: structuredClone(admission.input) };
        if (!prior) {
          binding = await executor.bind(context);
          const effects = await Promise.all(
            binding.effects.map(async (effect) =>
              effect.kind === "member" && !effect.location && this.environment?.effectPath
                ? { ...effect, location: await this.environment.effectPath(effect) }
                : effect,
            ),
          );
          row = {
            ...row,
            consumes: structuredClone([...context.consumed, ...(binding.consumes ?? [])]),
            claims: structuredClone(binding.claims ?? []),
            effects: structuredClone(effects),
            ...(binding.basis === undefined ? {} : { basis: binding.basis }),
          };
          context.consumed = structuredClone(row.consumes);
          context.basis = row.basis;
        }
        this.activeCallers.set(row.id, crossing.caller);
        await this.gate(row, "admit");
        for (const claim of row.claims) {
          if (claim.kind !== "reconciliation") continue;
          const original = this.rows.get(claim.id);
          if (
            !original ||
            original.id === row.id ||
            original.prepared.state !== "ready" ||
            this.pending.has(original.id) ||
            original.state === "running" ||
            original.state === "waiting" ||
            original.steps.some((step) => step.state === "unknown" || step.state === "running")
          )
            throw new CommandRejected({
              kind: "domain",
              code: "reconciliation.unresolved",
              message: "Reconcile only a stopped attempt whose effects all have known outcomes",
            });
        }
        const claimed = [...this.rows.values()].find(
          (other) =>
            other.id !== row.id &&
            holdsClaims(other) &&
            this.claimsOf(other).some((held) =>
              row.claims.some((claim) => canonicalRouteInput(held) === canonicalRouteInput(claim)),
            ),
        );
        if (claimed) {
          const claim = row.claims.find((candidate) =>
            this.claimsOf(claimed).some(
              (held) => canonicalRouteInput(held) === canonicalRouteInput(candidate),
            ),
          )!;
          throw new CommandRejected({ kind: "claimed", claim, by: claimed.id });
        }
        const blocked = [...this.rows.values()].find(
          (other) =>
            other.id !== row.id &&
            (other.state === "unknown" || other.state === "incomplete") &&
            !this.reconciles(row, other) &&
            effectsOverlap(row.effects, other.effects),
        );
        if (blocked)
          throw Error(
            `action '${blocked.id}' is ${blocked.state}; recover that attempt before submitting another`,
          );
      } catch (error) {
        this.activeCallers.delete(row.id);
        if (error instanceof Refused || prior) throw error;
        const failed = actionReceiptSchema.parse({
          ...row,
          state: "failed",
          error: messageOf(error),
          status: 409,
          notDispatched: true,
          ...(error instanceof CommandRejected ? { refusal: error.refusal } : {}),
        });
        await this.commit([failed]);
        this.notify();
        return structuredClone(failed);
      }
      row = actionReceiptSchema.parse({
        ...row,
        state: row.caller.kind === "pea" && row.effects.length ? "waiting" : "running",
      });
      try {
        await this.commit([row]);
      } catch (error) {
        this.activeCallers.delete(row.id);
        throw error;
      }
      this.notify();
      const save = (update: (current: ActionReceipt) => ActionReceipt) =>
        this.serial(async () => {
          row = this.rows.get(row.id) ?? row;
          const next = actionReceiptSchema.parse(update(row));
          await this.commit([next]);
          this.notify();
          row = next;
        });
      const releaseDispatch: (() => void)[] = [];
      let cursor = 0;
      const execution: ActionExecution = {
        get prepared() {
          return row.prepared.state === "ready" ? structuredClone(row.prepared.value) : undefined;
        },
        recorded: (kind, key) =>
          structuredClone(row.steps.findLast((step) => step.kind === kind && step.key === key)),
        effect: (effect) =>
          save((current) => ({
            ...current,
            effects: current.effects.some(
              (held) => canonicalRouteInput(held) === canonicalRouteInput(effect),
            )
              ? current.effects
              : [...current.effects, structuredClone(effect)],
          })),
        publishWork: (key, route, patches) =>
          execution.step("publication", "work.publish", { work: key, route, patches }, async () => {
            const work = this.environment?.work;
            const current = await work?.view(key, route);
            if (!work || !current) throw Error("Work publication is unavailable");
            const result = await work.publish(key, route, [...patches], current.revision);
            if (!result.ok) throw new ActionIncomplete("Work publication did not land", result);
            return result;
          }),
        retireWork: async (key, route, paths) => {
          const priorPublications = row.steps.filter(
            (step) =>
              step.state === "succeeded" &&
              step.kind === "publication" &&
              step.key === "work.retire" &&
              workKey((step.input as { work: WorkKey }).work) === workKey(key),
          );
          const priorResults = priorPublications.map(
            (step) =>
              (step as Extract<ActionStep, { state: "succeeded" }>).result as {
                fulfilled: WorkPath[];
                retired: WorkPath[];
                revision: number;
              },
          );
          const completed = new Set(
            priorResults.flatMap((result) => result.fulfilled.map(canonicalRouteInput)),
          );
          const outstanding = paths.filter((path) => !completed.has(canonicalRouteInput(path)));
          const alreadyRetired = priorResults
            .flatMap((result) => result.retired)
            .filter((path) =>
              paths.some(
                (requested) => canonicalRouteInput(requested) === canonicalRouteInput(path),
              ),
            );
          if (!outstanding.length) {
            const current = await this.environment?.work?.view(key, route);
            if (!current) throw Error("Work retirement is unavailable");
            return { retired: alreadyRetired, revision: current.revision };
          }
          const continuation = cursor;
          cursor = row.steps.length;
          try {
            const result = await execution.step(
              "publication",
              "work.retire",
              { work: key, route, paths: outstanding },
              async () => {
                if (
                  !row.effects.length ||
                  !row.steps.some(
                    (step) =>
                      step.state === "succeeded" &&
                      (step.kind === "file" || (step.kind === "native" && step.dispatchedAt)),
                  )
                )
                  throw new StepFailure(
                    "Retirement requires a proven external outcome",
                    409,
                    "refused",
                  );
                const work = this.environment?.work;
                const current = await work?.view(key, route);
                const original = row.consumes.find(
                  (dependency) =>
                    dependency.kind === "work" &&
                    workKey(dependency.probe.handle.key) === workKey(key),
                );
                if (!work || !current || original?.kind !== "work")
                  throw Error("Consumed Work is unavailable for retirement");
                const patches: RouteStatePatch[] = [];
                const retired: WorkPath[] = [];
                for (const path of outstanding) {
                  const before = valueAt(original.expected, path) as CellLike | undefined;
                  const now = valueAt(current.doc, path) as CellLike | undefined;
                  if (!before?.edit || !now) continue;
                  const next = transitionPatches(
                    path.slice(0, -1).map(String),
                    String(path.at(-1)),
                    now,
                    { kind: "retire", consumed: before.edit },
                  );
                  if (next.some((patch) => patch.path.at(-1) === "edit")) retired.push([...path]);
                  patches.push(...next);
                }
                if (patches.length) {
                  const publication = await work.publish(key, route, patches, current.revision);
                  if (!publication.ok)
                    throw new ActionIncomplete("Work retirement did not land", publication);
                  return {
                    retired,
                    revision: publication.revision,
                    patches,
                    fulfilled: outstanding,
                  };
                }
                return { retired, revision: current.revision, patches, fulfilled: outstanding };
              },
            );
            return { retired: [...alreadyRetired, ...result.retired], revision: result.revision };
          } finally {
            cursor = continuation;
          }
        },
        retire: async (id, reason) => {
          const ended = row.steps.find((step) => step.id === id);
          if (!resume || ended?.state !== "succeeded")
            throw Error("Only a resumed attempt retires a succeeded step");
          const { result: _result, state: _state, ...intent } = ended;
          const retired: ActionStep = {
            ...intent,
            state: "failed",
            error: reason,
            status: 410,
            retired: true,
            evidence: { result: ended.result },
          };
          await save((current) => ({
            ...current,
            steps: current.steps.map((step) => (step.id === id ? retired : step)),
          }));
          return structuredClone(retired);
        },
        step: async (kind, key, input, effect, options) => {
          const process = options?.process;
          if (kind === "native") validateNativeInput(key, input);
          while (cursor < row.steps.length) {
            const previous = row.steps[cursor++]!;
            if (
              previous.state === "succeeded" &&
              previous.kind === "publication" &&
              previous.key === "work.retire" &&
              key !== "work.retire"
            )
              continue;
            if (resume && previous.state === "failed") {
              if (previous.notDispatched || previous.retired) continue;
              throw Error(
                "A dispatched failed effect needs explicit reconciliation before it can repeat",
              );
            }
            if (
              previous.kind !== kind ||
              previous.key !== key ||
              canonicalRouteInput(previous.input) !== canonicalRouteInput(input) ||
              (process && canonicalRouteInput(previous.process) !== canonicalRouteInput(process))
            )
              throw Error(
                "Original continuation differs from its recorded effect input or process",
              );
            if (previous.state === "succeeded") {
              const result = structuredClone(previous.result) as never;
              options?.check?.(result);
              return result;
            }
            throw Error("An uncertain effect cannot be replayed");
          }
          const incarnation = row.consumes.find(
            (dependency) =>
              dependency.kind === "incarnation" &&
              canonicalRouteInput(dependency.probe.target) === canonicalRouteInput(row.target),
          );
          const exactProcess =
            process ??
            (incarnation?.kind === "incarnation" ? incarnation.probe.process : undefined);
          const step: ActionStep = {
            id: randomUUID(),
            kind,
            key,
            input: structuredClone(input),
            ...(kind === "native" && exactProcess
              ? { process: structuredClone(exactProcess) }
              : {}),
            state: "running",
          };
          await save((current) => ({ ...current, steps: [...current.steps, step] }));
          cursor = row.steps.length;
          if (kind === "native")
            releaseDispatch.push(
              bindActionDispatch(step.id, {
                refusal: () => this.dispatchRefusal(step.id),
                validate: () => this.validateDispatch(step.id),
                dispatched: () => this.markDispatched(step.id),
              }),
            );
          let result: Awaited<ReturnType<typeof effect>>;
          let returned = false;
          let entered = false;
          try {
            await this.export(row.id, `steps/${step.id}.json`, step).catch((error) => {
              throw refused(`Step input export failed: ${String(error)}`, "step.export");
            });
            row = this.rows.get(row.id) ?? row;
            const postcondition =
              kind === "publication" &&
              key === "work.retire" &&
              row.steps.some(
                (held) =>
                  held.state === "succeeded" &&
                  (held.kind === "file" || (held.kind === "native" && held.dispatchedAt)),
              );
            await this.gate(row, "step", postcondition);
            entered = true;
            result = await effect(step.id);
            returned = true;
            options?.check?.(result);
          } catch (error) {
            await save((current) => ({
              ...current,
              ...(error instanceof CommandRejected ? { refusal: error.refusal } : {}),
              steps: current.steps.map((held) => {
                if (held.id !== step.id) return held;
                const outcome: DispatchFailure = !entered
                  ? {
                      state:
                        error instanceof StepFailure && error.status === 499
                          ? "cancelled"
                          : "failed",
                      error: messageOf(error),
                      status: error instanceof StepFailure ? error.status : 409,
                      notDispatched: true,
                    }
                  : returned
                    ? error instanceof StepFailure && error.outcome !== "refused"
                      ? failure(error)
                      : {
                          state: "failed",
                          error: messageOf(error),
                          status: 409,
                          evidence: { result: structuredClone(result) },
                        }
                    : entered && error instanceof CommandRejected
                      ? { state: "unknown", error: error.message, status: 503 }
                      : failure(error);
                // A domain refusal cannot erase the journal's durable dispatch evidence.
                if (held.dispatchedAt && "notDispatched" in outcome && outcome.notDispatched) {
                  const { notDispatched: _, ...uncertain } = outcome;
                  return { ...held, ...uncertain, state: "unknown" };
                }
                return { ...held, ...outcome };
              }),
            }));
            throw error;
          }
          // Persistence is outside the effect catch: a missing receipt never proves no dispatch.
          const releases = (await options?.releases?.(result)) ?? [];
          const dispatched = this.rows
            .get(row.id)
            ?.steps.find((held) => held.id === step.id)?.dispatchedAt;
          if (
            releases.length &&
            (kind !== "native" ||
              !dispatched ||
              releases.some(
                (release) =>
                  release.claim.kind !== "session-slot" ||
                  !this.rows
                    .get(release.action)
                    ?.claims.some(
                      (claim) => canonicalRouteInput(claim) === canonicalRouteInput(release.claim),
                    ),
              ))
          )
            throw Error(
              "A logical session claim releases only with a matching dispatched native outcome",
            );
          await save((current) => ({
            ...current,
            steps: current.steps.map((held) =>
              held.id === step.id
                ? {
                    ...held,
                    state: "succeeded",
                    result: structuredClone(result ?? null),
                    ...(releases.length ? { releases: structuredClone(releases) } : {}),
                  }
                : held,
            ),
          }));
          return result;
        },
      };
      let validated = row.prepared.state === "ready";
      const releaseRun = subscribeRunChanges(() => {
        try {
          if (row.effects.length) commandCheckpoint(originOf(row.caller), row.consent);
        } catch {
          this.cancelWaits.get(row.id)?.();
          void save((current) => ({ ...current, cancellationRequested: true })).catch(() => {});
        }
      });
      const completion = Promise.resolve()
        .then(async () => {
          if (!prior)
            await this.export(row.id, "admission.json", {
              ...admission,
              consumes: row.consumes,
              claims: row.claims,
              effects: row.effects,
            });
          await this.gate(row, "authorize");
          const cancelled = new Promise<never>((_, reject) =>
            this.cancelWaits.set(row.id, () =>
              reject(new StepFailure("Command cancelled before authorization", 499, "refused")),
            ),
          );
          let consent: CommandConsent | null;
          try {
            consent = await Promise.race([
              authorizeCommand(originOf(row.caller), row.id, row.effects),
              cancelled,
            ]);
          } catch (error) {
            throw new StepFailure(String(error), 499, "refused");
          } finally {
            this.cancelWaits.delete(row.id);
          }
          await save((current) => ({ ...current, state: "running", consent }));
          await this.gate(row, "consented");
          await this.waitForTurn(row.id);
          if (row.prepared.state !== "ready") {
            const value = structuredClone(
              executor.prepared.parse((await binding?.prepare?.()) ?? null),
            );
            await this.export(row.id, "preparation.json", value);
            await save((current) => ({ ...current, prepared: { state: "ready", value } }));
          }
          validated = true;
          await this.gate(row, "prepared");
          const result = await executor.run(context, execution);
          return definition.result ? definition.result.parse(result) : result;
        })
        .then(
          (result) => settle(true, row.steps, { kind: "returned", result }),
          (error) => ({
            ...settle(validated, row.steps, { kind: "threw", error })!,
            ...(error instanceof CommandRejected ? { refusal: error.refusal } : {}),
          }),
        )
        .then((settled) => ({ ...unsettled(row), ...settled }) as ActionReceipt)
        .then((finished) =>
          this.serial(async () => {
            const next = actionReceiptSchema.parse({
              ...finished,
              steps: interruptedSteps(finished.steps),
            });
            try {
              await this.commit([next]);
            } catch (error) {
              this.index({
                ...row,
                state: "unknown",
                error: `Completion could not be persisted: ${String(error)}`,
                steps: interruptedSteps(row.steps),
                status: 503,
              });
              this.notify();
              this.pending.delete(row.id);
              throw error;
            } finally {
              this.activeCallers.delete(row.id);
              releaseRun();
              releaseDispatch.forEach((release) => release());
            }
            this.notify();
            this.pending.delete(row.id);
            return structuredClone(next);
          }),
        );
      this.pending.set(row.id, completion);
      void completion.catch(() => undefined);
      return structuredClone(row);
    });
  }
  /**
   * Signal the running action's in-flight bridge request. `signal` is given the step id, which IS
   * the requestId the step was dispatched under, so the host can reach it past the session gate.
   * Returns at once with the still-running row: the op settles `cancelled` at its own checkpoint.
   */
  async cancel(id: string): Promise<ActionReceipt> {
    const row = (await this.list(undefined, id))[0];
    if (!row) throw Error(`Action '${id}' has no admitted receipt`);
    if (row.state !== "running" && row.state !== "waiting")
      throw Error(`Action '${id}' is ${row.state}; only an active action can be cancelled`);
    await this.serial(async () => {
      const current = this.rows.get(id)!;
      await this.commit([{ ...current, cancellationRequested: true }]);
      this.notify();
    });
    this.cancelWaits.get(id)?.();
    const step = row.steps.find((step) => step.state === "running" && step.kind === "native");
    if (step) {
      const cancel = this.environment?.resolve(row.key).cancel;
      if (!cancel) throw Error("Native cancellation is unavailable");
      await cancel(step.id);
    }
    return (await this.list(undefined, id))[0] ?? row;
  }

  async recover(id: string): Promise<ActionReceipt> {
    const original = (await this.list(undefined, id))[0];
    if (!original) throw Error(`Action '${id}' has no admitted receipt`);
    if (original.refusal?.kind === "domain" && original.refusal.code === "historical-schema")
      return original;
    if (original.state !== "unknown" && original.state !== "incomplete") return original;
    const executor = this.environment?.resolve(original.key);
    if (!executor?.recover) throw Error("This command has no recovery adapter");
    if (original.prepared.state === "ready") executor.prepared.parse(original.prepared.value);
    const recover = executor.recover;
    const incomplete = original.state === "incomplete";
    if (original.prepared.state !== "ready") return original;
    const updates: {
      step: ActionStep;
      evidence: unknown;
      observation?: Extract<ReceiptFact, { kind: "native" }>;
    }[] = [];
    for (const step of original.steps)
      if (step.kind === "native" || step.state === "unknown" || incomplete) {
        try {
          const update = await recover(
            structuredClone(step),
            structuredClone(original.prepared.value),
            structuredClone(original.target),
          );
          if (
            update.step.id !== step.id ||
            update.step.key !== step.key ||
            update.step.kind !== step.kind ||
            canonicalRouteInput(update.step.input) !== canonicalRouteInput(step.input) ||
            (step.process &&
              update.step.process &&
              canonicalRouteInput(step.process) !== canonicalRouteInput(update.step.process))
          )
            throw Error("Recovery cannot change a step's immutable intent or process");
          // Recovery supplies a new outcome. Obsolete fields from the previous state are not
          // part of that outcome; the journal retains immutable intent and dispatch evidence.
          const variant = actionStepSchema.options.find(
            (schema) => schema.shape.state.value === update.step.state,
          )!;
          update.step = actionStepSchema.parse({
            ...variant.strip().parse(update.step),
            ...(step.process ? { process: step.process } : {}),
            ...(step.dispatchedAt ? { dispatchedAt: step.dispatchedAt } : {}),
            ...(step.releases ? { releases: step.releases } : {}),
          });
          updates.push({
            ...update,
            evidence:
              incomplete || step.state !== update.step.state
                ? { previous: step, receipt: update.evidence }
                : update.evidence,
          });
        } catch (error) {
          updates.push({ step, evidence: { error: String(error) } });
        }
      }
    return this.serial(async () => {
      const current = this.rows.get(id)!;
      if (canonicalRouteInput(current) !== canonicalRouteInput(original))
        return structuredClone(current);
      let nextRow: ActionReceipt = {
        ...current,
        steps: current.steps.map(
          (step) => updates.find((update) => update.step.id === step.id)?.step ?? step,
        ),
        recovery: [
          ...current.recovery.filter(
            (entry) => !updates.some((update) => update.step.id === entry.stepId),
          ),
          ...updates.map((update) => ({
            stepId: update.step.id,
            at: new Date().toISOString(),
            evidence: update.evidence,
          })),
        ],
      };
      const settled = settle(true, nextRow.steps, { kind: "recovered" });
      if (settled) nextRow = { ...unsettled(nextRow), ...settled } as ActionReceipt;
      nextRow = actionReceiptSchema.parse(nextRow);
      const native = updates.flatMap((update) => {
        if (!update.observation) return [];
        const body = update.observation;
        const old = [...this.receipts.values()].find(
          (r) =>
            r.body.kind === "native" &&
            canonicalRouteInput(r.body.localRef) === canonicalRouteInput(body.localRef),
        );
        if (old && canonicalRouteInput(old.body) === canonicalRouteInput(body)) return [];
        return [
          receiptSchema.parse({
            schema: 1,
            id: old?.id ?? randomUUID(),
            revision: (old?.revision ?? 0) + 1,
            at: new Date().toISOString(),
            // SDK recovery proves an outcome, not the build of the native producer.
            stamp: null,
            join: this.joinForRequest(update.step.id),
            body,
          }),
        ];
      });
      await this.commit([nextRow], native);
      this.notify();
      return structuredClone(nextRow);
    });
  }
  private serial<A>(work: () => Promise<A>): Promise<A> {
    const next = this.tail
      .catch(() => undefined)
      .then(() => this.loadOnce())
      .then(work);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async load(): Promise<void> {
    const originalBytes = await readFile(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (originalBytes === null) return;
    const version = JSON.parse(originalBytes.toString("utf8").split("\n")[0]!)?.version;
    const archive = `${this.path}.v${String(version)}.${Date.now()}.archived`;
    const snapshot = readJournalSnapshot(originalBytes, archive);
    if (!snapshot) {
      await renameReplacing(this.path, archive);
      console.warn(
        `${this.path} has unsupported journal version ${String(version)}; archived as ${archive}`,
      );
      return;
    }
    const { receipts, mappings, imported } = snapshot;
    this.torn = snapshot.torn;
    this.lines = snapshot.lines;
    this.header = true;
    for (const [key, id] of mappings) this.mappings.set(key, id);
    if (new Set(this.mappings.values()).size !== this.mappings.size)
      throw Error("Duplicate opaque identity in action journal");
    for (const r of receipts) {
      const previous = this.receipts.get(r.id);
      if (previous && previous.revision >= r.revision)
        throw Error("Duplicate receipt id in action journal");
      this.keep(r);
    }
    const current = [...this.receipts.values()].flatMap((r) =>
      r.body.kind === "action" ? [r.body.value] : [],
    );
    for (const r of this.receipts.values())
      if (
        r.body.kind === "action" &&
        canonicalRouteInput(r.join) !== canonicalRouteInput(this.rootJoin(r.body.value.id))
      )
        throw Error("Action receipt join does not match its persisted mapping");
    if (new Set(current.map((r) => r.id)).size !== current.length)
      throw Error("Duplicate action id in action journal");
    this.fresh = [];
    const changed: ActionReceipt[] = [];
    for (const row of current) {
      let next = row;
      if (row.state === "waiting") {
        next = {
          ...row,
          state: "cancelled",
          error: "consent.stopped: host restarted during approval",
          status: 499,
        };
      } else if (row.state === "running") {
        const steps = interruptedSteps(row.steps);
        next = {
          ...unsettled(row),
          steps,
          ...settle(row.prepared.state === "ready", steps, { kind: "interrupted" })!,
        } as ActionReceipt;
      }
      if (next.steps.some((step) => step.state === "running"))
        next = { ...next, steps: interruptedSteps(next.steps) };
      next = actionReceiptSchema.parse(next);
      this.index(next);
      if (canonicalRouteInput(next) !== canonicalRouteInput(row)) changed.push(next);
    }
    if (imported) {
      await writeFile(archive, originalBytes, { flag: "wx" });
      this.torn = true;
    }
    if (this.torn) await this.compact();
    if (changed.length) await this.commit(changed);
    this.notify();
  }

  /** Append the revisions these rows and facts make, and any freshly minted mappings. */
  private async commit(rows: readonly ActionReceipt[] = [], facts: readonly Receipt[] = []) {
    const at = new Date().toISOString();
    const receipts = rows.flatMap((row) => {
      const old = this.receipts.get(this.actionReceipt.get(row.id) ?? "");
      if (
        old?.body.kind === "action" &&
        canonicalRouteInput(old.body.value) === canonicalRouteInput(row)
      )
        return [];
      return [
        receiptSchema.parse({
          schema: 1,
          id: old?.id ?? randomUUID(),
          revision: (old?.revision ?? 0) + 1,
          at,
          stamp: old ? old.stamp : this.stamp(),
          join: old?.join ?? this.rootJoin(row.id),
          body: { kind: "action", value: row },
        }),
      ];
    });
    receipts.push(...facts);
    const lines = [
      ...this.fresh.map((key) => ({ mapping: [key, this.mappings.get(key)] })),
      ...receipts.map((receipt) => ({ receipt })),
    ];
    if (lines.length) {
      if (!this.header) await mkdir(dirname(this.path), { recursive: true });
      const text = `${this.torn ? "\n" : ""}${this.header ? "" : '{"version":7}\n'}${lines
        .map((line) => `${JSON.stringify(line)}\n`)
        .join("")}`;
      try {
        await appendFile(this.path, text, "utf8");
      } catch (error) {
        this.torn = true;
        throw error;
      }
      this.header = true;
      this.torn = false;
      this.lines += lines.length;
    }
    this.fresh = [];
    for (const row of rows) this.index(row);
    for (const receipt of receipts) this.keep(receipt);
    this.committed.push(...receipts);
    if (
      this.lines > 2 * Math.max(this.receipts.size, 1000) ||
      this.factCount > this.retain + Math.max(this.retain / 10, 1)
    )
      await this.compact();
  }

  private index(row: ActionReceipt) {
    this.rows.set(row.id, row);
    for (const step of row.steps) this.stepAction.set(step.id, row.id);
    if (isOpen(row)) this.open.add(row.id);
    else this.open.delete(row.id);
  }
  private keep(receipt: Receipt) {
    if (receipt.body.kind !== "action" && !this.receipts.has(receipt.id)) this.factCount++;
    this.receipts.set(receipt.id, receipt);
    if (receipt.body.kind === "action") this.actionReceipt.set(receipt.body.value.id, receipt.id);
  }

  /** Commands keep their immutable identity and outcome forever; only telemetry facts expire. */
  private async compact() {
    const facts = [...this.receipts.values()].filter((receipt) => receipt.body.kind !== "action");
    for (const receipt of facts.slice(0, Math.max(0, facts.length - this.retain))) {
      this.receipts.delete(receipt.id);
      this.factCount--;
    }
    const named = new Set(
      [...this.receipts.values()].flatMap((r) => [
        ...Object.values(r.join),
        ...(r.body.kind === "queue" ? [r.body.processSessionId] : []),
      ]),
    );
    for (const [key, id] of this.mappings)
      if (!named.has(id) && !this.minted.has(key)) this.mappings.delete(key);
    const lines = [
      ...[...this.mappings].map((mapping) => ({ mapping })),
      ...[...this.receipts.values()].map((receipt) => ({ receipt })),
    ];
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      `${this.path}.tmp`,
      `{"version":7}\n${lines.map((line) => `${JSON.stringify(line)}\n`).join("")}`,
      "utf8",
    );
    await renameReplacing(`${this.path}.tmp`, this.path);
    this.header = true;
    this.torn = false;
    this.fresh = [];
    this.minted = new Set();
    this.lines = lines.length;
  }
}
