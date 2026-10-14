import { BridgeError } from "./bridge.ts";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import { z } from "zod";
import {
  canonicalRouteInput,
  actionReceiptSchema,
  actionAdmissionSchema,
  actionBasesSchema,
  type ActionAdmission,
  type ActionStep,
  type Basis,
  type Caller,
  type DocumentRef,
  type ExecutionTarget,
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
import { live } from "./control.ts";

/** Who crossed and why it was admitted: host-minted, stamped on the receipt beside the admission. */
export type Crossing = { readonly caller: Caller; readonly basis: Basis | null };

export type ActionExecution = {
  step<A>(
    kind: ActionStep["kind"],
    key: string,
    input: unknown,
    execute: (requestId: string) => Promise<A>,
  ): Promise<A>;
  publish(result: unknown): Promise<void>;
  readonly prepared: unknown;
  /** The latest recorded step of this kind and key: the one a resume replays or redoes. */
  recorded(kind: ActionStep["kind"], key: string): ActionStep | undefined;
  /**
   * A resume retires a succeeded step whose lifetime SDK truth says ended (a dead Revit): it is
   * kept as failed with what it returned, and the resume redoes it as a new step.
   */
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
  | Pick<Extract<ActionReceipt, { state: "cancelled" }>, "state" | "error" | "status">;
/** One error's step-level answer: refused before dispatch, cancelled, or uncertain. */
const failure = (error: unknown): DispatchFailure => {
  const problem = error as { message?: string; statusCode?: number } | null;
  const nativeOutcome = error instanceof BridgeError ? error.nativeOutcome : undefined;
  const notDispatched =
    error instanceof BridgeError &&
    (error.evidence.notDispatched === true ||
      nativeOutcome === "CancelledBeforeDispatch" ||
      nativeOutcome === "RefusedQueueUnresponsive" ||
      nativeOutcome === "RefusedQueueDisposed");
  const dispatched = error instanceof BridgeError && error.evidence.dispatched === true;
  const detail = {
    ...(error instanceof BridgeError && error.evidence.result !== undefined
      ? { evidence: { result: error.evidence.result } }
      : {}),
    error: problem?.message ?? String(error),
    status: problem?.statusCode ?? 503,
    ...(nativeOutcome ? { nativeOutcome } : {}),
    ...(error instanceof BridgeError && error.evidence.issues
      ? { issues: [...error.evidence.issues] }
      : {}),
  };
  return notDispatched
    ? { ...detail, state: "failed", notDispatched: true }
    : detail.status === CANCELLED_STATUS
      ? { state: "cancelled", error: detail.error, status: detail.status }
      : dispatched
        ? { ...detail, state: "failed" }
        : { ...detail, state: "unknown" };
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
type Settled = { state: Exclude<ActionReceipt["state"], "running"> } & Record<string, unknown>;

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
  if (!prepared)
    return {
      state: "failed",
      error: reason?.error ?? "Preparation did not finish",
      status: 409,
      notDispatched: true,
      ...(thrown && "issues" in thrown && thrown.issues ? { issues: thrown.issues } : {}),
    };
  const uncertain = steps.find((step) => step.state === "unknown" || step.state === "running");
  if (uncertain) {
    if (cause.kind === "recovered") return null;
    const detail =
      thrown?.state === "unknown"
        ? thrown
        : {
            error: `Step '${uncertain.key}' has no proven outcome${reason ? `; ${reason.error}` : ""}`,
            status: 503,
          };
    return { ...detail, state: "unknown" };
  }
  if (cause.kind === "returned") return { state: "succeeded", result: cause.result ?? null };
  const cancelled =
    thrown?.state === "cancelled"
      ? thrown
      : cause.kind !== "threw"
        ? steps.find((step) => step.state === "cancelled")
        : undefined;
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
    ...(steps.length === 0 || ("notDispatched" in why && why.notDispatched === true)
      ? { notDispatched: true }
      : {}),
    ...(thrown && "nativeOutcome" in thrown && thrown.nativeOutcome
      ? { nativeOutcome: thrown.nativeOutcome }
      : {}),
    ...(thrown && "issues" in thrown && thrown.issues ? { issues: thrown.issues } : {}),
    ...(why && "evidence" in why && why.evidence ? { evidence: why.evidence } : {}),
  };
}

const sessionOf = (target: ExecutionTarget) =>
  target.kind === "sdk-session"
    ? `sdk:${canonicalRouteInput(target.selection)}`
    : target.kind === "session"
      ? target.session
      : target.kind === "document"
        ? target.ref.session
        : null;
/**
 * An uncertain attempt blocks only what it could have touched: the same document lifetime, or a
 * session and anything on it. Never the whole host: one crashed script must not refuse every
 * action on every session (headless research, Hazard 3).
 */
const overlaps = (a: ExecutionTarget, b: ExecutionTarget) =>
  a.kind !== "host" &&
  b.kind !== "host" &&
  sessionOf(a) === sessionOf(b) &&
  (a.kind !== "document" || b.kind !== "document" || a.ref.openId === b.ref.openId);

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

/** Settled receipts kept by compaction; open actions are never dropped. */
const RETAIN_RECEIPTS = 10_000;
/** A row that blocks overlapping admissions and must stay visible until recovered. */
const isOpen = (row: ActionReceipt) =>
  row.state === "running" || row.state === "unknown" || row.state === "incomplete";

/**
 * One host journal. Execution never holds the authored Work lock or the journal write tail.
 *
 * Storage is append-only lines: a `{"version":5}` header, then one `{receipt}` per committed
 * revision and one `{mapping}` per minted opaque id; the last revision of an id wins. A commit
 * appends only what it changed, and compaction rewrites the newest {@link RETAIN_RECEIPTS} settled
 * receipts plus every open action once the file holds twice what is live.
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
  private header = false;
  private torn = false;
  private committed: Receipt[] = [];
  private readonly subscribers = new Set<(receipt: Receipt) => void>();
  private loaded?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<ActionReceipt>>();
  private readonly listeners = new Set<() => void>();
  private readonly reads = new OwnerReads();
  constructor(
    private readonly path: string,
    private readonly stamp: () => ReceiptStamp | null = () => null,
    private readonly retain = RETAIN_RECEIPTS,
  ) {}
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

  async list(target?: DocumentRef, id?: string): Promise<ActionReceipt[]> {
    await this.loadOnce();
    await this.tail;
    const rows = id ? [this.rows.get(id)].filter((row) => row !== undefined) : this.rows.values();
    return structuredClone(
      [...rows].filter(
        (row) =>
          (!target ||
            (row.destination.kind === "document" &&
              row.destination.ref.session === target.session &&
              row.destination.ref.openId === target.openId)) &&
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
    await rename(`${file}.tmp`, file);
  }
  async admit(
    raw: ActionAdmission & Crossing,
    prepare: () => Promise<unknown>,
    execute: (execution: ActionExecution) => Promise<unknown>,
    resume = false,
  ): Promise<ActionReceipt> {
    const { caller, basis, ...authored } = raw;
    const admission = actionAdmissionSchema.parse(authored);
    return this.serial(async () => {
      const prior = this.rows.get(admission.id);
      const identity = (row: ActionReceipt) => ({
        id: row.id,
        kind: row.kind,
        key: row.key,
        destination: row.destination,
        input: row.request,
        bases: row.bases,
      });
      if (prior) {
        if (canonicalRouteInput(identity(prior)) !== canonicalRouteInput(admission))
          throw Error(
            `request id '${admission.id}' conflicts with its admitted intent, target or bases`,
          );
        if (!resume || (prior.state !== "unknown" && prior.state !== "incomplete"))
          return structuredClone(prior);
        if (prior.preparation.state !== "ready")
          throw Error("Original consumed values were not frozen; cannot resume this attempt");
        if (prior.steps.some((step) => step.state === "unknown" || step.state === "running"))
          throw Error("Recover every uncertain step before resuming the original action");
      }
      const opening = admission.key === "instances.start" || admission.key === "instances.open";
      const blocked =
        !opening &&
        [...this.open]
          .map((id) => this.rows.get(id)!)
          .find(
            (row) =>
              row.id !== admission.id &&
              (row.state === "running" ||
                row.state === "unknown" ||
                (row.key === "schedule.grid.push" && row.state === "incomplete")) &&
              (overlaps(admission.destination, row.destination) ||
                (row.key === "schedule.grid.push" &&
                  admission.key === row.key &&
                  admission.bases.work &&
                  canonicalRouteInput(admission.bases.work.key) ===
                    canonicalRouteInput(
                      actionBasesSchema.safeParse(row.bases).data?.work?.key ?? null,
                    )) ||
                (typeof admission.input.workspaceId === "string" &&
                  row.request.workspaceId === admission.input.workspaceId) ||
                (typeof admission.input.path === "string" &&
                  row.request.path === admission.input.path)),
          );
      if (blocked)
        throw Error(
          `action '${blocked.id}' is ${blocked.state}; recover that attempt before submitting another`,
        );
      let row: ActionReceipt = {
        id: admission.id,
        kind: admission.kind,
        key: admission.key,
        // A resume is admitted afresh under its own caller; it never inherits the original basis.
        caller,
        basis,
        destination: admission.destination,
        request: admission.input,
        bases: admission.bases,
        steps: prior?.steps ?? [],
        preparation: prior?.preparation ?? { state: "unprepared" },
        recovery: prior?.recovery ?? [],
        publication: prior?.publication ?? { state: "unrequested" },
        startedAt: prior?.startedAt ?? new Date().toISOString(),
        state: "running",
      };
      await this.commit([row]);
      this.notify();
      const save = (update: (current: ActionReceipt) => ActionReceipt) =>
        this.serial(async () => {
          const nextRow = actionReceiptSchema.parse(update(row));
          await this.commit([nextRow]);
          this.notify();
          row = nextRow;
        });
      let cursor = 0;
      const execution: ActionExecution = {
        get prepared() {
          return row.preparation.state === "ready" ? row.preparation.value : undefined;
        },
        recorded: (kind, key) =>
          structuredClone(row.steps.findLast((step) => step.kind === kind && step.key === key)),
        retire: async (id, reason) => {
          const ended = row.steps.find((step) => step.id === id);
          if (!resume || ended?.state !== "succeeded")
            throw Error("Only a resumed attempt retires a succeeded step");
          const retired: ActionStep = {
            id,
            key: ended.key,
            kind: ended.kind,
            input: ended.input,
            state: "failed",
            error: reason,
            status: 410,
            evidence: { result: ended.result },
          };
          await save((row) => ({
            ...row,
            steps: row.steps.map((step) => (step.id === id ? retired : step)),
          }));
          return structuredClone(retired);
        },
        step: async (kind, key, input, effect) => {
          while (cursor < row.steps.length) {
            const priorStep = row.steps[cursor++]!;
            // A failed step is an earlier attempt's history; the resume redoes from it.
            if (resume && priorStep.state === "failed") continue;
            if (
              priorStep.kind !== kind ||
              priorStep.key !== key ||
              canonicalRouteInput(priorStep.input) !== canonicalRouteInput(input)
            )
              throw Error("Original continuation differs from its recorded effect input");
            if (priorStep.state === "succeeded") return structuredClone(priorStep.result) as never;
            throw Error("An uncertain effect cannot be replayed");
          }
          const step: ActionStep = {
            id: randomUUID(),
            kind,
            key,
            input: structuredClone(input),
            state: "running",
          };
          await save((row) => {
            if (opening && kind === "native") {
              const running = [...this.pending.keys()]
                .map((id) => this.rows.get(id)!)
                .find(
                  (other) =>
                    other.id !== row.id &&
                    other.state === "running" &&
                    other.steps.some(
                      (active) =>
                        active.state === "running" &&
                        active.kind === kind &&
                        active.key === key &&
                        canonicalRouteInput(active.input) === canonicalRouteInput(input),
                    ),
                );
              if (running)
                throw new BridgeError(
                  `action '${running.id}' is already opening this target`,
                  409,
                  {
                    notDispatched: true,
                  },
                );
            }
            return { ...row, steps: [...row.steps, step] };
          });
          cursor = row.steps.length;
          let result;
          try {
            await this.export(row.id, `steps/${step.id}.json`, {
              id: step.id,
              kind,
              key,
              input: step.input,
            }).catch((error) => {
              throw new BridgeError(`Step input export failed: ${String(error)}`, 503, {
                notDispatched: true,
              });
            });
            const dead = live(row.basis);
            if (dead) throw new BridgeError(dead.message, 403, { notDispatched: true });
            result = await effect(step.id);
          } catch (error) {
            await save((row) => ({
              ...row,
              steps: row.steps.map((current) =>
                current.id === step.id ? { ...step, ...failure(error) } : current,
              ),
            }));
            throw error;
          }
          // Persistence is outside the effect catch: a missing receipt is never proof of no dispatch.
          await save((row) => ({
            ...row,
            steps: row.steps.map((current) =>
              current.id === step.id
                ? { ...step, state: "succeeded", result: result ?? null }
                : current,
            ),
          }));
          return result;
        },
        publish: (result) =>
          save((row) => ({ ...row, publication: { state: "recorded", result } })),
      };
      let validated = row.preparation.state === "ready";
      const completion = Promise.resolve()
        .then(async () => {
          // A resumed attempt exported both when it was first admitted and prepared.
          if (!prior) await this.export(row.id, "admission.json", admission);
          if (row.preparation.state !== "ready") {
            const value = await prepare();
            await this.export(row.id, "preparation.json", value ?? null);
            await save((row) => ({
              ...row,
              preparation: { state: "ready", value: value ?? null },
            }));
          }
          validated = true;
        })
        .then(() => execute(execution))
        .then(
          (result) => settle(true, row.steps, { kind: "returned", result }),
          (error) => settle(validated, row.steps, { kind: "threw", error }),
        )
        .then((settled) => ({ ...unsettled(row), ...settled! }) as ActionReceipt)
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
            }
            this.notify();
            this.pending.delete(row.id);
            return actionReceiptSchema.parse(structuredClone(next));
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
  async cancel(
    id: string,
    signal: (requestId: string) => Promise<unknown>,
  ): Promise<ActionReceipt> {
    const row = (await this.list(undefined, id))[0];
    if (!row) throw Error(`Action '${id}' has no admitted receipt`);
    if (row.state !== "running")
      throw Error(`Action '${id}' is ${row.state}; only a running action can be cancelled`);
    const step = row.steps.find((step) => step.state === "running" && step.kind === "native");
    if (!step) throw Error(`Action '${id}' has dispatched nothing to Revit yet`);
    await signal(step.id);
    return (await this.list(undefined, id))[0] ?? row;
  }
  async recover(
    id: string,
    read: (
      step: ActionStep,
      prepared: unknown,
    ) => Promise<{
      step: ActionStep;
      evidence: unknown;
      observation?: Extract<ReceiptFact, { kind: "native" }>;
    }>,
    revisit?: (step: ActionStep) => boolean,
  ): Promise<ActionReceipt> {
    const original = (await this.list(undefined, id))[0];
    if (!original) throw Error(`Action '${id}' has no admitted receipt`);
    const incompleteSchedule =
      original.key === "schedule.grid.push" && original.state === "incomplete";
    if (
      (original.state !== "unknown" && !incompleteSchedule) ||
      original.preparation.state !== "ready"
    )
      return original;
    const updates: {
      step: ActionStep;
      evidence: unknown;
      observation?: Extract<ReceiptFact, { kind: "native" }>;
    }[] = [];
    for (const step of original.steps)
      if (
        step.kind === "native" &&
        (step.state === "unknown" || incompleteSchedule || revisit?.(step))
      ) {
        try {
          const update = await read(step, original.preparation.value);
          updates.push(
            incompleteSchedule
              ? {
                  step: update.step.state === "succeeded" ? update.step : step,
                  evidence: { previous: step, receipt: update.evidence },
                  observation: update.observation,
                }
              : update,
          );
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
    const raw = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return;
    const lines = raw.split("\n");
    const head = JSON.parse(lines[0]!);
    const receipts: Receipt[] = [];
    const mappings: [string, string][] = [];
    if (head?.version === 4) {
      // ponytail: one-way import of the whole-file journal; delete once no host holds a v4 file.
      const envelope = z
        .strictObject({
          version: z.literal(4),
          receipts: receiptSchema.array(),
          mappings: z.record(z.string(), z.uuid()),
        })
        .parse(head);
      receipts.push(...envelope.receipts);
      mappings.push(...Object.entries(envelope.mappings));
      this.torn = true;
    } else if (head?.version === 5) {
      const line = z.union([
        z.strictObject({ receipt: receiptSchema }),
        z.strictObject({ mapping: z.tuple([z.string(), z.uuid()]) }),
      ]);
      lines.slice(1).forEach((text, i) => {
        if (!text) return;
        let entry;
        try {
          entry = line.parse(JSON.parse(text));
        } catch (error) {
          // Only the last line can be torn by a crash; anything earlier is a corrupt journal.
          if (i === lines.length - 2) return void (this.torn = true);
          throw error;
        }
        if ("receipt" in entry) receipts.push(entry.receipt);
        else mappings.push(entry.mapping);
      });
      this.lines = lines.length - 1;
    } else
      throw Error(
        `${this.path} is journal version ${String(head?.version)}; this host reads version 5: archive or delete it, then restart.`,
      );
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
      if (row.state === "running") {
        const steps = interruptedSteps(row.steps);
        next = {
          ...unsettled(row),
          steps,
          ...settle(row.preparation.state === "ready", steps, { kind: "interrupted" })!,
        } as ActionReceipt;
      }
      if (next.steps.some((step) => step.state === "running"))
        next = { ...next, steps: interruptedSteps(next.steps) };
      next = actionReceiptSchema.parse(next);
      this.index(next);
      if (canonicalRouteInput(next) !== canonicalRouteInput(row)) changed.push(next);
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
      const text = `${this.torn ? "\n" : ""}${this.header ? "" : '{"version":5}\n'}${lines
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
      this.receipts.size > this.retain + Math.max(this.retain / 10, 1)
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
    this.receipts.set(receipt.id, receipt);
    if (receipt.body.kind === "action") this.actionReceipt.set(receipt.body.value.id, receipt.id);
  }

  /** Rewrite the newest settled receipts, every open action, and the mappings they still name. */
  private async compact() {
    const settled = [...this.receipts.values()].filter(
      (r) => r.body.kind !== "action" || !this.open.has(r.body.value.id),
    );
    for (const r of settled.slice(0, Math.max(0, settled.length - this.retain))) {
      this.receipts.delete(r.id);
      if (r.body.kind !== "action") continue;
      const row = r.body.value;
      this.rows.delete(row.id);
      this.actionReceipt.delete(row.id);
      for (const step of row.steps) this.stepAction.delete(step.id);
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
      `{"version":5}\n${lines.map((line) => `${JSON.stringify(line)}\n`).join("")}`,
      "utf8",
    );
    await rename(`${this.path}.tmp`, this.path);
    this.header = true;
    this.torn = false;
    this.fresh = [];
    this.minted = new Set();
    this.lines = lines.length;
  }
}
