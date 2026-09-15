import { BridgeError } from "./bridge.ts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { OwnerReads, type OwnerValue } from "@pe/runtime";
import {
  canonicalRouteInput,
  actionReceiptSchema,
  actionAdmissionSchema,
  actionBasesSchema,
  type ActionAdmission,
  type ActionStep,
  type DocumentRef,
  type ActionReceipt,
} from "@pe/agent-contracts";

export type ActionExecution = {
  step<A>(
    kind: ActionStep["kind"],
    key: string,
    input: unknown,
    execute: (requestId: string) => Promise<A>,
  ): Promise<A>;
  publish(result: unknown): Promise<void>;
  readonly prepared: unknown;
  recorded(kind: ActionStep["kind"], key: string): ActionStep | undefined;
};
type DispatchFailure =
  | Pick<
      Extract<ActionReceipt, { state: "failed" }>,
      "state" | "error" | "status" | "nativeOutcome" | "issues" | "notDispatched" | "evidence"
    >
  | Pick<
      Extract<ActionReceipt, { state: "unknown" }>,
      "state" | "error" | "status" | "nativeOutcome" | "issues" | "evidence"
    >;
const failure = (error: unknown): DispatchFailure => {
  const problem = error as { message?: string; statusCode?: number } | null;
  const nativeOutcome = error instanceof BridgeError ? error.nativeOutcome : undefined;
  const notDispatched =
    error instanceof BridgeError &&
    (error.evidence.notDispatched === true ||
      nativeOutcome === "CancelledBeforeDispatch" ||
      nativeOutcome === "RefusedQueueUnresponsive" ||
      nativeOutcome === "RefusedQueueDisposed");
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

/** One host journal. Execution never holds the authored Work lock or the journal write tail. */
export class ActionJournal {
  private rows: ActionReceipt[] = [];
  private readonly loaded: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<ActionReceipt>>();
  private readonly listeners = new Set<() => void>();
  private readonly reads = new OwnerReads();
  constructor(private readonly path: string) {
    this.loaded = this.load();
  }

  async list(target?: DocumentRef, id?: string): Promise<ActionReceipt[]> {
    await this.loaded;
    await this.tail;
    return structuredClone(
      this.rows.filter(
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
    for (const listener of this.listeners) listener();
  }
  async wait(id: string): Promise<ActionReceipt> {
    await this.loaded;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const row = (await this.list(undefined, id))[0];
    if (!row) throw Error(`Action '${id}' has no admitted receipt`);
    return row;
  }
  async admit(
    raw: ActionAdmission,
    prepare: () => Promise<unknown>,
    execute: (execution: ActionExecution) => Promise<unknown>,
    resume = false,
  ): Promise<ActionReceipt> {
    const admission = actionAdmissionSchema.parse(raw);
    return this.serial(async () => {
      const prior = this.rows.find((row) => row.id === admission.id);
      const identity = (row: ActionReceipt) => ({
        id: row.id,
        kind: row.kind,
        key: row.key,
        actor: row.actor,
        destination: row.destination,
        input: row.request,
        bases: row.bases,
      });
      if (prior) {
        if (canonicalRouteInput(identity(prior)) !== canonicalRouteInput(admission))
          throw Error(
            `request id '${admission.id}' conflicts with its admitted intent, actor, target or bases`,
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
        this.rows.find(
          (row) =>
            row.id !== admission.id &&
            (row.state === "running" ||
              row.state === "unknown" ||
              (row.key === "schedule-grid.apply" && row.state === "incomplete")) &&
            ((row.state === "unknown" &&
              row.preparation.state === "ready" &&
              ["native-leaf", "host-leaf"].includes(
                String((row.preparation.value as { kind?: string })?.kind),
              )) ||
              (canonicalRouteInput(admission.destination) ===
                canonicalRouteInput(row.destination) &&
                admission.destination.kind !== "host") ||
              (row.key === "schedule-grid.apply" &&
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
        actor: admission.actor,
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
      const admitted = prior
        ? this.rows.map((current) => (current.id === row.id ? row : current))
        : [...this.rows, row];
      await this.persist(admitted);
      this.rows = admitted;
      this.notify();
      const save = (update: (current: ActionReceipt) => ActionReceipt) =>
        this.serial(async () => {
          const nextRow = actionReceiptSchema.parse(update(row));
          const next = this.rows.map((current) => (current.id === row.id ? nextRow : current));
          await this.persist(next);
          this.rows = next;
          this.notify();
          row = nextRow;
        });
      let cursor = 0;
      const execution: ActionExecution = {
        get prepared() {
          return row.preparation.state === "ready" ? row.preparation.value : undefined;
        },
        recorded: (kind, key) =>
          structuredClone(row.steps.find((step) => step.kind === kind && step.key === key)),
        step: async (kind, key, input, effect) => {
          while (cursor < row.steps.length) {
            const priorStep = row.steps[cursor++]!;
            if (
              priorStep.kind !== kind ||
              priorStep.key !== key ||
              canonicalRouteInput(priorStep.input) !== canonicalRouteInput(input)
            )
              throw Error("Original continuation differs from its recorded effect input");
            if (priorStep.state === "succeeded") return structuredClone(priorStep.result) as never;
            if (resume && priorStep.state === "failed") continue;
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
              const running = this.rows.find(
                (other) =>
                  other.id !== row.id &&
                  this.pending.has(other.id) &&
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
          if (row.preparation.state !== "ready") {
            const value = await prepare();
            await save((row) => ({
              ...row,
              preparation: { state: "ready", value: value ?? null },
            }));
          }
          validated = true;
        })
        .then(() => execute(execution))
        .then(
          (result) => ({ ...row, state: "succeeded" as const, result: result ?? null }),
          (error) => {
            if (!validated)
              return {
                ...row,
                state: "failed" as const,
                error: failure(error).error,
                status: 409,
                notDispatched: true as const,
              };
            const failed = failure(error);
            if (
              (error instanceof ActionIncomplete || failed.state === "failed") &&
              row.steps.some((step) => step.state === "succeeded" && step.kind !== "publication") &&
              !row.steps.some((step) => step.state === "unknown" || step.state === "running")
            )
              return {
                ...row,
                state: "incomplete" as const,
                error: failed.error,
                status: failed.status,
                result: error instanceof ActionIncomplete ? error.result : null,
              };
            // A later refusal does not roll back a prior completed external step.
            if (
              row.steps?.some((step) => step.state === "succeeded" && step.kind !== "publication")
            ) {
              const uncertain = {
                error: failed.error,
                status: failed.status,
                nativeOutcome: failed.nativeOutcome,
                issues: failed.issues,
                evidence: failed.evidence,
              };
              return { ...row, ...uncertain, state: "unknown" as const };
            }
            return { ...row, ...failed };
          },
        )
        .then((finished) =>
          this.serial(async () => {
            const index = this.rows.findIndex((current) => current.id === row.id);
            const next = [...this.rows];
            next[index] = actionReceiptSchema.parse({
              ...finished,
              steps: interruptedSteps(finished.steps),
            });
            try {
              await this.persist(next);
            } catch (error) {
              this.rows[index] = {
                ...row,
                state: "unknown",
                error: `Completion could not be persisted: ${String(error)}`,
                steps: interruptedSteps(row.steps),
                status: 503,
              };
              this.notify();
              this.pending.delete(row.id);
              throw error;
            }
            this.rows = next;
            this.notify();
            this.pending.delete(row.id);
            return actionReceiptSchema.parse(structuredClone(next[index]));
          }),
        );
      this.pending.set(row.id, completion);
      void completion.catch(() => undefined);
      return structuredClone(row);
    });
  }
  async recover(
    id: string,
    read: (step: ActionStep, prepared: unknown) => Promise<{ step: ActionStep; evidence: unknown }>,
  ): Promise<ActionReceipt> {
    const original = (await this.list(undefined, id))[0];
    if (!original) throw Error(`Action '${id}' has no admitted receipt`);
    const incompleteSchedule =
      original.key === "schedule-grid.apply" && original.state === "incomplete";
    if (
      (original.state !== "unknown" && !incompleteSchedule) ||
      original.preparation.state !== "ready"
    )
      return original;
    const updates: { step: ActionStep; evidence: unknown }[] = [];
    for (const step of original.steps)
      if (step.kind === "native" && (step.state === "unknown" || incompleteSchedule)) {
        try {
          const update = await read(step, original.preparation.value);
          updates.push(
            incompleteSchedule
              ? {
                  step: update.step.state === "succeeded" ? update.step : step,
                  evidence: { previous: step, receipt: update.evidence },
                }
              : update,
          );
        } catch (error) {
          updates.push({ step, evidence: { error: String(error) } });
        }
      }
    return this.serial(async () => {
      const current = this.rows.find((row) => row.id === id)!;
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
      if (nextRow.steps.length && nextRow.steps.every((step) => step.state === "failed")) {
        const last = nextRow.steps.at(-1)!;
        if (last.state === "failed")
          nextRow = {
            ...nextRow,
            state: "failed",
            error: last.error,
            status: last.status,
            notDispatched: true,
          };
      }
      nextRow = actionReceiptSchema.parse(nextRow);
      const next = this.rows.map((row) => (row.id === id ? nextRow : row));
      await this.persist(next);
      this.rows = next;
      this.notify();
      return structuredClone(nextRow);
    });
  }
  private serial<A>(work: () => Promise<A>): Promise<A> {
    const next = this.tail
      .catch(() => undefined)
      .then(() => this.loaded)
      .then(work);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async load(): Promise<void> {
    const raw = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return JSON.stringify({ version: 3, actions: [] });
      throw error;
    });
    const decoded = JSON.parse(raw);
    if (decoded?.version !== 3 || !Array.isArray(decoded.actions))
      throw Error("Invalid action journal envelope");
    let changed = false;
    const current = actionReceiptSchema.array().parse(decoded.actions);
    const rows = current.map((row) => {
      let next = row;
      if (row.state === "running") {
        changed = true;
        next = {
          ...row,
          state: "unknown",
          error: "Host restarted before the executor recorded an outcome",
          status: 503,
        };
      }
      if (next.steps.some((step) => step.state === "running")) {
        changed = true;
        next = { ...next, steps: interruptedSteps(next.steps) };
      }
      return actionReceiptSchema.parse(next);
    });
    if (changed) await this.persist(rows);
    this.rows = rows;
  }

  private async persist(rows = this.rows): Promise<void> {
    // ponytail: one bounded-use action receipt file; split by attempt when measured size requires it.
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify({ version: 3, actions: rows }), "utf8");
    await rename(`${this.path}.tmp`, this.path);
  }
}
