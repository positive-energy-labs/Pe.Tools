import { createHash, randomUUID } from "node:crypto";
import { Context, Effect, Exit, Layer, Option, RcMap, Schema } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { Workflow } from "effect/workflow";
import {
  CommandFailure,
  CommandId,
  ExecutionId,
  Generation,
  OwnerOutcome,
  type OwnerStepObservation,
  type CommandObservation,
  type CommandRef,
  type InertTicket,
  type NewCommand,
} from "../../../../packages/agent-contracts/src/command-authority.ts";
import {
  Binding,
  CommandDescriptor,
  CommandRow,
  commandLimits,
  json,
  type CommandLimits,
} from "./model.ts";
import type { CommandClosure } from "./closure.ts";
import { makeActivityResults } from "./activity-results.ts";

// This tag and its reference-only envelope do not vary with feature schemas or adapter names.
const root = Workflow.make("Pe.CommandWorkflow", {
  payload: { id: CommandId },
  idempotencyKey: (p) => p.id,
  success: Schema.String,
  error: CommandFailure,
});

export interface AdmissionFacts {
  readonly plan: string;
  readonly claims: readonly string[];
  /** Version observed outside the writer and compared synchronously in the acceptance decision. */
  readonly version: string;
}
export interface CommandAdapter {
  readonly normalize: (input: string) => Effect.Effect<string, CommandFailure>;
  readonly prepare: (row: CommandRow) => Effect.Effect<AdmissionFacts, CommandFailure>;
}
export interface CommandAuthority {
  /** Read-only outside observation; no writer is held while this waits. */
  readonly observe: (binding: Binding) => Effect.Effect<string, CommandFailure>;
  /** No I/O or wait between this check and the SQL decision. Never reconstructed from row.caller. */
  readonly current: (binding: Binding, version: string) => boolean;
}
export interface FoundationOptions {
  readonly generation: typeof Generation.Type;
  readonly closure: CommandClosure;
  readonly authority: CommandAuthority;
  readonly adapters: ReadonlyMap<string, CommandAdapter>;
  readonly limits?: CommandLimits;
}
type Service = Effect.Success<ReturnType<typeof makeService>>;
export class CommandService extends Context.Service<CommandService, Service>()(
  "Pe/CommandService",
) {}
const failure = (problem: CommandFailure["problem"], ref: CommandRef | null = null) =>
  new CommandFailure({ problem, ref });
const observation = (row: CommandRow): CommandObservation => ({
  ref: { id: row.id },
  state: row.state,
  stop: row.stop,
  result: row.result,
  problem: row.problem,
  ownerSteps: [],
});
const decodeRow = Schema.decodeUnknownEffect(CommandRow);
const decodeDescriptor = Schema.decodeUnknownEffect(CommandDescriptor);

/** Must run only after exclusive custody, fence/header reconciliation, and before engine construction. */
export const initializeCommandTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE command_authority (
    id TEXT PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL,
    stopped INTEGER NOT NULL DEFAULT 0, result TEXT, problem TEXT, admission_order INTEGER UNIQUE,
    reserved_bytes INTEGER NOT NULL, parent TEXT, stop_with_parent INTEGER NOT NULL)`;
  yield* sql`CREATE TABLE command_claims (claim TEXT PRIMARY KEY, command_id TEXT NOT NULL)`;
  yield* sql`CREATE TABLE command_steps (
    command_id TEXT NOT NULL, occurrence INTEGER NOT NULL, descriptor TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE, started INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(command_id,occurrence))`;
  yield* sql`CREATE TABLE command_plans (command_id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
});

export const makeService = (options: FoundationOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const activityResult = yield* makeActivityResults(root);
    const limits = options.limits ?? commandLimits;
    const storage = <A, R>(body: Effect.Effect<A, CommandFailure | SqlError, R>) =>
      body.pipe(Effect.catchTag("SqlError", () => Effect.fail(failure("storage"))));
    const load = Effect.fn("CommandService.load")(function* (ref: CommandRef) {
      const rows = yield* sql<{
        body: string;
        state: CommandRow["state"];
        stopped: number;
        result: string | null;
        problem: CommandRow["problem"];
      }>`
      SELECT body,state,stopped,result,problem FROM command_authority WHERE id=${ref.id}`;
      if (!rows.length) return yield* failure("unavailable", ref);
      const raw = yield* Effect.try({
        try: () => JSON.parse(rows[0].body),
        catch: () => failure("storage", ref),
      });
      const row = yield* decodeDescriptor(raw).pipe(Effect.mapError(() => failure("storage", ref)));
      if (row.id !== ref.id || row.generation !== options.generation)
        return yield* failure("unavailable", ref);
      const digest = createHash("sha256")
        .update(
          json({
            normalized: { key: row.key, input: row.input },
            binding: row.binding,
            manifest: row.manifest,
          }),
        )
        .digest("hex");
      if (digest !== row.digest) return yield* failure("storage", ref);
      return yield* decodeRow({
        ...row,
        state: rows[0].state,
        stop: rows[0].stopped !== 0,
        result: rows[0].result,
        problem: rows[0].problem,
      }).pipe(Effect.mapError(() => failure("storage", ref)));
    });
    const visible = (row: CommandRow, binding: Binding) =>
      row.binding.principal === binding.principal && row.binding.authority === binding.authority;
    const observeRow = Effect.fn("CommandService.observeRow")(function* (row: CommandRow) {
      const steps =
        yield* sql`SELECT occurrence,descriptor FROM command_steps WHERE command_id=${row.id} ORDER BY occurrence`;
      const ownerSteps: OwnerStepObservation[] = [];
      for (const raw of steps) {
        const step = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ occurrence: Schema.Int, descriptor: Schema.String }),
        )(raw).pipe(Effect.mapError(() => failure("storage", { id: row.id })));
        const descriptor = yield* Effect.try({
          try: () => JSON.parse(step.descriptor),
          catch: () => failure("storage", { id: row.id }),
        });
        const { kind } = yield* Schema.decodeUnknownEffect(Schema.Struct({ kind: Schema.String }))(
          descriptor,
        ).pipe(Effect.mapError(() => failure("storage", { id: row.id })));
        if (kind !== "native" && kind !== "outside") continue;
        const { identity, result } = yield* activityResult(row, step.occurrence, OwnerOutcome);
        ownerSteps.push(
          Option.isNone(result)
            ? { _tag: "Unresolved", ...identity, reason: "pending" }
            : Exit.isFailure(result.value)
              ? { _tag: "Unresolved", ...identity, reason: "activity-failed" }
              : { _tag: "Recorded", ...identity, outcome: result.value.value },
        );
      }
      return { ...observation(row), ownerSteps };
    });
    const requireNotStopped = Effect.fn("CommandService.requireNotStopped")(function* (
      ref: CommandRef,
    ) {
      const stopped = yield* sql`WITH RECURSIVE ancestry(id,parent,stopped,stop_with_parent) AS (
      SELECT id,parent,stopped,stop_with_parent FROM command_authority WHERE id=${ref.id}
      UNION ALL SELECT p.id,p.parent,p.stopped,p.stop_with_parent FROM command_authority p
        JOIN ancestry child ON p.id=child.parent WHERE child.stop_with_parent=1
      ) SELECT id FROM ancestry WHERE stopped=1 LIMIT 1`;
      if (stopped.length) return yield* failure("stopped", ref);
    });
    const decision = Effect.fn("CommandService.decision")(function* (
      ref: CommandRef,
      version: string,
    ) {
      const row = yield* load(ref);
      yield* requireNotStopped(ref);
      if (
        row.tag !== root._tag ||
        row.execution !== (yield* root.executionId(ref)) ||
        row.manifest !== options.closure.identity
      )
        return yield* failure("incompatible", ref);
      if (!options.authority.current(row.binding, version))
        return yield* failure("unauthorized", ref);
      return row;
    });
    const gate = Effect.fn("CommandService.gate")(function* (ref: CommandRef) {
      yield* options.closure.verify;
      const row = yield* load(ref);
      const authorityVersion = yield* options.authority.observe(row.binding);
      return { ...(yield* decision(ref, authorityVersion)), authorityVersion };
    });
    const preparations = yield* RcMap.make({
      capacity: limits.active,
      idleTimeToLive: 0,
      lookup: (id: typeof CommandId.Type) =>
        Effect.gen(function* () {
          const row = yield* load({ id });
          const adapter = options.adapters.get(row.key);
          if (!adapter) return yield* failure("incompatible", { id });
          return yield* adapter.prepare(row);
        }),
    });
    const allocate = Effect.fn("CommandService.allocate")(function* (
      intent: NewCommand,
      binding: Binding,
    ) {
      yield* options.closure.verify;
      if (
        Buffer.byteLength(intent.input) > limits.requestBytes ||
        Buffer.byteLength(intent.key) > limits.claimBytes
      )
        return yield* failure("overload");
      const adapter = options.adapters.get(intent.key);
      if (!adapter) return yield* failure("invalid");
      const input = yield* adapter.normalize(intent.input);
      const normalized = { key: intent.key, input };
      if (Buffer.byteLength(input) > limits.requestBytes) return yield* failure("overload");
      const version = yield* options.authority.observe(binding);
      if (!options.authority.current(binding, version)) return yield* failure("unauthorized");
      // Randomness creates inert authority only; never used at an effect/retry boundary.
      const id = Schema.decodeUnknownSync(CommandId)(randomUUID());
      const ref = { id };
      const execution = Schema.decodeUnknownSync(ExecutionId)(yield* root.executionId(ref));
      const row: CommandRow = {
        id,
        generation: options.generation,
        execution,
        tag: root._tag,
        manifest: options.closure.identity,
        key: normalized.key,
        input,
        binding,
        state: "allocated",
        stop: false,
        result: null,
        problem: null,
        digest: createHash("sha256")
          .update(json({ normalized, binding, manifest: options.closure.identity }))
          .digest("hex"),
      };
      const { state: _state, stop: _stop, result: _result, problem: _problem, ...descriptor } = row;
      const body = json(descriptor);
      if (Buffer.byteLength(body) > limits.requestBytes * 2) return yield* failure("overload");
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [count] = yield* sql<{ n: number; bytes: number; accepted: number }>`
        SELECT count(*) AS n,coalesce(sum(reserved_bytes),0) AS bytes,count(admission_order) AS accepted FROM command_authority`;
          if (
            count.n >= limits.tickets ||
            count.bytes + Buffer.byteLength(body) > limits.authorityBytes
          )
            return yield* failure("overload");
          if (count.n + 1 + count.accepted * (2 * limits.steps + 1) > limits.safetyRows)
            return yield* failure("overload");
          if (binding.parent) {
            const parent = yield* load({ id: binding.parent });
            if (!visible(parent, binding) || (binding.stopWithParent && parent.stop))
              return yield* failure("stopped");
            if (binding.stopWithParent) yield* requireNotStopped({ id: binding.parent });
          }
          yield* sql`INSERT INTO command_authority(id,body,state,reserved_bytes,parent,stop_with_parent)
        VALUES(${id},${body},'allocated',${Buffer.byteLength(body)},${binding.parent},${binding.stopWithParent ? 1 : 0})`;
        }),
      );
      return {
        _tag: "InertTicket",
        ref,
        authored: intent,
        intent: normalized,
      } satisfies InertTicket;
    });
    const submit = Effect.fn("CommandService.submit")(function* (
      ref: CommandRef,
      binding: Binding,
    ) {
      const row = yield* load(ref);
      if (!visible(row, binding) || json(row.binding) !== json(binding))
        return yield* failure("conflict", ref);
      // Duplicate submit does not resolve/prepare the feature again. Observation is not new permission.
      if (row.state !== "allocated") return yield* observeRow(row);
      yield* gate(ref);
      const facts = yield* RcMap.get(preparations, row.id).pipe(
        Effect.catchTag("ExceededCapacityError", () => Effect.fail(failure("overload", ref))),
      );
      if (Buffer.byteLength(facts.plan) > limits.planBytes || facts.claims.length > limits.steps)
        return yield* failure("overload", ref);
      if (facts.claims.some((claim) => Buffer.byteLength(claim) > limits.claimBytes))
        return yield* failure("overload", ref);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* load(ref);
          if (current.state !== "allocated") return yield* observeRow(current);
          yield* decision(ref, facts.version);
          const [count] = yield* sql<{ n: number; active: number; bytes: number }>`
        SELECT count(admission_order) AS n,
        coalesce(sum(CASE WHEN state='accepted' THEN 1 ELSE 0 END),0) AS active,
        coalesce(sum(reserved_bytes),0) AS bytes FROM command_authority`;
          if (
            count.n >= limits.accepted ||
            count.active >= limits.active ||
            count.bytes + limits.reservedCommandBytes > limits.authorityBytes
          )
            return yield* failure("overload", ref);
          const [all] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM command_authority`;
          if (all.n + (count.n + 1) * (2 * limits.steps + 1) > limits.safetyRows)
            return yield* failure("overload", ref);
          for (const claim of [...new Set(facts.claims)]) {
            const owned = yield* sql`SELECT command_id FROM command_claims WHERE claim=${claim}`;
            if (owned.length) return yield* failure("conflict", ref);
            yield* sql`INSERT INTO command_claims(claim,command_id) VALUES(${claim},${ref.id})`;
          }
          yield* sql`INSERT INTO command_plans(command_id,body) VALUES(${ref.id},${facts.plan})`;
          yield* sql`UPDATE command_authority SET state='accepted',admission_order=${count.n + 1},
        reserved_bytes=reserved_bytes+${limits.reservedCommandBytes} WHERE id=${ref.id}`;
          // Same SqlClient service and fiber transaction context as admission/claims. No completion wait.
          const execution = yield* root.execute(ref, { discard: true });
          if (execution !== row.execution) return yield* failure("incompatible", ref);
          return observation({ ...current, state: "accepted" });
        }),
      );
    });
    const read = Effect.fn("CommandService.read")(function* (ref: CommandRef, binding: Binding) {
      const row = yield* load(ref);
      if (!visible(row, binding)) return yield* failure("unauthorized", ref);
      return yield* observeRow(row);
    });
    const stop = Effect.fn("CommandService.stop")(function* (ref: CommandRef, binding: Binding) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const row = yield* load(ref);
          if (!visible(row, binding)) return yield* failure("unauthorized", ref);
          yield* sql`UPDATE command_authority SET stopped=1,
        state=CASE WHEN state='allocated' THEN 'stopped' ELSE state END WHERE id=${ref.id}`;
          return { ref, status: "stop-recorded" as const };
        }),
      );
    });
    return {
      allocate: (...args: Parameters<typeof allocate>) => storage(allocate(...args)),
      submit: (...args: Parameters<typeof submit>) => storage(Effect.scoped(submit(...args))),
      read: (...args: Parameters<typeof read>) => storage(read(...args)),
      stop: (...args: Parameters<typeof stop>) => storage(stop(...args)),
      gate,
      decision,
      load,
      sql,
      limits,
      activityResult: <A>(ref: CommandRef, occurrence: number, success: Schema.Codec<A>) =>
        storage(Effect.flatMap(load(ref), (row) => activityResult(row, occurrence, success))),
    };
  });

/** Internal interpreter registration only. Producers never receive the raw Workflow. */
export const commandInterpreter = <R>(
  run: (row: CommandRow, plan: string) => Effect.Effect<string, CommandFailure, R>,
) =>
  root.toLayer(
    Effect.fn("CommandWorkflow.root")(function* (ref, execution) {
      const service = yield* CommandService;
      return yield* Effect.gen(function* () {
        const row = yield* service
          .gate(ref)
          .pipe(
            Effect.mapError((error) =>
              error instanceof CommandFailure ? error : failure("storage", ref),
            ),
          );
        if (row.state !== "accepted" || row.execution !== execution)
          return yield* failure("unavailable", ref);
        const plans = yield* service.sql<{
          body: string;
        }>`SELECT body FROM command_plans WHERE command_id=${ref.id}`.pipe(
          Effect.mapError(() => failure("storage", ref)),
        );
        if (!plans.length) return yield* failure("unavailable", ref);
        // No feature decode/resolve before the root gate above.
        const result = yield* run(row, plans[0].body);
        if (Buffer.byteLength(result) > service.limits.stepBytes)
          return yield* failure("overload", ref);
        yield* service.sql
          .withTransaction(
            Effect.gen(function* () {
              yield* service.load(ref);
              yield* service.sql`UPDATE command_authority SET state='terminal',result=${result} WHERE id=${ref.id}`;
              // Claims intentionally remain held here. Release needs matching effect-owner dispatch evidence.
            }),
          )
          .pipe(Effect.mapError(() => failure("storage", ref)));
        return result;
      }).pipe(
        Effect.catchTag("CommandFailure", (error) =>
          service.sql`
      UPDATE command_authority SET state='blocked',problem=${error.problem} WHERE id=${ref.id} AND state='accepted'`.pipe(
            Effect.ignore,
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
    }),
  );

export const commandServiceLayer = (options: FoundationOptions) =>
  Layer.effect(CommandService, makeService(options));
